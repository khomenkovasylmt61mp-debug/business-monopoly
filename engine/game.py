# -*- coding: utf-8 -*-
"""Classic Monopoly engine. No external dependencies."""
import random
import secrets
import time
import threading

from .data import (BOARD, BOARD_BRANDS, BRAND_CARD_WORDS, GROUPS, GROUP_TILES,
                   CHANCE, CHEST, MISSIONS, MISSION_BY_ID, PLAYER_COLORS, PIECES, scale_for)

START_MONEY = 1500
MAX_PLAYERS = 12
JAIL_FINE = 50
AUCTION_STEP = 10
AUCTION_TIMEOUT = 30.0
TRADE_TIMEOUT = 90.0
MAX_TRADES_TURN = 3


class RulesError(Exception):
    pass


def fmt(n):
    return f"{int(round(n)):,}".replace(",", " ") + " ₴"


class Room:
    def __init__(self, code, seed=None):
        self.code = code
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.rng = random.Random(seed) if seed is not None else random.SystemRandom()
        self.counter = 0
        self.trade_seq = 0
        self.theme = "brands"
        self.board = BOARD_BRANDS
        self.state = {
            "code": code,
            "phase": "lobby",
            "options": {"mode": "company", "parkingPot": False, "theme": "brands", "turnTimer": 60},
            "players": [],
            "host": None,
            "turn": None,
            "dice": None,
            "doubles": 0,
            "awaiting": None,
            "tiles": [{"owner": None, "houses": 0, "mortgaged": False} for _ in BOARD],
            "housesLeft": 32,
            "hotelsLeft": 12,
            "decks": {"chance": [], "chest": []},
            "log": [],
            "chat": [],
            "chatSeq": 0,
            "version": 0,
            "auction": None,
            "trade": None,
            "lastCard": None,
            "winner": None,
            "pot": 0,
            "round": 1,
            "turns": 0,
            "rentBoost": 1.0,
            "updated": time.time(),
            "startedAt": None,
            "turnActivity": None,
        }

    # ---------- players ----------

    def _new_id(self):
        self.counter += 1
        return f"p{self.counter}"

    def add_player(self, name, token, bot=False):
        with self.cond:
            st = self.state
            name = (name or "").strip()[:16] or "Гравець"
            if st["phase"] != "lobby":
                raise RulesError("Гра вже почалася")
            if len(st["players"]) >= MAX_PLAYERS:
                raise RulesError("Кімната заповнена (12 гравців)")
            used = {p["color"] for p in st["players"]}
            color = next((c for c in PLAYER_COLORS if c["key"] not in used), PLAYER_COLORS[0])
            used_pieces = {p.get("piece") for p in st["players"]}
            piece = next((x for x in PIECES if x["icon"] not in used_pieces), PIECES[0])
            pid = self._new_id()
            if bot:
                token = secrets.token_urlsafe(18)
            if bot:
                names = {p["name"] for p in st["players"]}
                n = 1
                while f"Бот {n}" in names:
                    n += 1
                name = f"Бот {n}"
            st["players"].append({
                "id": pid,
                "name": name,
                "color": color["key"],
                "hex": color["hex"],
                "piece": piece["icon"],
                "pieceName": piece["name"],
                "token": token,
                "money": 0,
                "pos": 0,
                "jail": False,
                "jailTurns": 0,
                "cards": 0,
                "getoutDecks": [],
                "bankrupt": False,
                "bot": bool(bot),
                "debt": None,
                "credit": None,
                "creditCool": 0,
                "missions": [],
                "trades": 0,
                "casinoWins": 0,
                "lastSeen": time.time(),
                "joined": time.time(),
            })
            if st["host"] is None:
                st["host"] = pid
            elif not bot and st["phase"] == "lobby":
                hostp = self._player(st["host"]) if st["host"] else None
                if hostp and hostp["bot"]:
                    st["host"] = pid
            self._log(f"{name} зайшов у гру", "join", pid)
            self._bump()
            return pid

    def remove_player(self, pid):
        with self.cond:
            st = self.state
            p = self._player(pid)
            if st["phase"] == "lobby":
                st["players"] = [x for x in st["players"] if x["id"] != pid]
                if st["host"] == pid:
                    st["host"] = self._pick_host()
                self._log(f"{p['name']} вийшов", "leave", pid)
            else:
                if not p["bankrupt"]:
                    self._bankrupt(p, None, quit_game=True)
                # leaving mid-game removes the seat, so a restart cannot revive it
                st["players"] = [x for x in st["players"] if x["id"] != pid]
                if st["host"] == pid:
                    st["host"] = self._pick_host()
                    if st["host"]:
                        self._log(f"Новим власником кімнати стає {self._player(st['host'])['name']}", "info")
                if st["auction"]:
                    auc = st["auction"]
                    auc["active"] = [x for x in auc["active"] if x != pid]
                    if auc["turn"] == pid:
                        try:
                            self._auction_advance()
                        except Exception:
                            pass
                if st["trade"] and pid in (st["trade"].get("from"), st["trade"].get("to")):
                    st["trade"] = None
            self._bump()

    # ---------- utils ----------

    def _player(self, pid):
        for p in self.state["players"]:
            if p["id"] == pid:
                return p
        raise RulesError("Гравця не знайдено")

    def _by_token(self, token):
        for p in self.state["players"]:
            if p["token"] == token:
                return p
        raise RulesError("Сесію не знайдено")

    def _cur(self):
        st = self.state
        if not st["turn"]:
            return None
        return self._player(st["turn"])

    def _alive(self):
        return [p for p in self.state["players"] if not p["bankrupt"]]

    def _pick_host(self):
        st = self.state
        alive = [p for p in st["players"] if not p["bankrupt"]]
        humans = [p for p in alive if not p["bot"]]
        pool = humans or alive or st["players"]
        return pool[0]["id"] if pool else None

    def _next_alive(self, pid):
        ps = self._alive()
        if not ps:
            return None
        ids = [p["id"] for p in ps]
        if pid not in ids:
            return ids[0]
        return ids[(ids.index(pid) + 1) % len(ids)]

    def _log(self, text, kind="info", pid=None):
        st = self.state
        st["log"].append({"id": len(st["log"]) + 1, "text": text, "kind": kind,
                          "pid": pid, "t": time.time()})
        if len(st["log"]) > 400:
            st["log"] = st["log"][-300:]

    def _bump(self):
        self.state["version"] += 1
        self.state["updated"] = time.time()
        self.cond.notify_all()

    def _require(self, pid):
        p = self._player(pid)
        st = self.state
        if st["phase"] != "playing":
            raise RulesError("Гра не йде")
        if p["bankrupt"]:
            raise RulesError("Ви збанкрутували")
        return p

    def _require_turn(self, pid):
        p = self._require(pid)
        if self.state["turn"] != pid:
            raise RulesError("Зараз не ваш хід")
        return p

    def _aw(self, kind):
        st = self.state
        aw = st["awaiting"]
        if not aw or aw.get("type") != kind:
            raise RulesError("Дія зараз недоступна")
        return aw

    # ---------- start ----------

    def start(self, pid):
        with self.cond:
            st = self.state
            if st["phase"] != "lobby":
                raise RulesError("Гра вже почалася")
            if st["host"] != pid:
                raise RulesError("Почати може лише власник кімнати")
            if len(st["players"]) < 2:
                raise RulesError("Потрібно щонайменше 2 гравці")
            hostp = self._player(st["host"]) if st["host"] else None
            if hostp and hostp["bot"]:
                humans = [p for p in st["players"] if not p["bot"]]
                if humans:
                    st["host"] = humans[0]["id"]
            n = len(st["players"])
            mode = st["options"].get("mode", "company")
            parking = bool(st["options"].get("parkingPot", False))
            theme = st["options"].get("theme", "brands")
            try:
                turn_timer = int(st["options"].get("turnTimer", 60) or 0)
            except (TypeError, ValueError):
                turn_timer = 60
            if turn_timer not in (0, 30, 60, 90):
                turn_timer = 60
            self.theme = theme
            self.board = BOARD_BRANDS if theme == "brands" else BOARD
            if mode == "classic":
                sc = {"startMoney": 1500, "houses": 32, "hotels": 12,
                      "rent": 1.0, "label": "Офіційні правила"}
            else:
                sc = scale_for(n)
            st["options"] = {
                "players": n,
                "mode": mode,
                "parkingPot": parking,
                "theme": theme,
                "startMoney": sc["startMoney"],
                "houses": sc["houses"],
                "hotels": sc["hotels"],
                "rentMult": sc["rent"],
                "scaleLabel": sc["label"],
                "accel": mode != "classic",
                "turnTimer": turn_timer,
            }
            st["pot"] = 0
            st["round"] = 1
            st["turns"] = 0
            st["rentBoost"] = 1.0
            money = sc["startMoney"]
            for p in st["players"]:
                p["money"] = money
                p["pos"] = 0
                p["jail"] = False
                p["jailTurns"] = 0
                p["cards"] = 0
                p["bankrupt"] = False
                p["debt"] = None
                p["credit"] = None
                p["creditCool"] = 0
                picks = self.rng.sample(MISSIONS, 2)
                p["missions"] = [{"id": m["id"], "done": False} for m in picks]
                p["trades"] = 0
                p["casinoWins"] = 0
            st["decks"]["chance"] = self.rng.sample(CHANCE, len(CHANCE))
            st["decks"]["chest"] = self.rng.sample(CHEST, len(CHEST))
            st["tiles"] = [{"owner": None, "houses": 0, "mortgaged": False} for _ in BOARD]
            st["housesLeft"] = sc["houses"]
            st["hotelsLeft"] = sc["hotels"]
            st["phase"] = "playing"
            st["startedAt"] = time.time()
            st["log"] = []
            order = [p["id"] for p in st["players"]]
            st["turn"] = order[0]
            st["doubles"] = 0
            st["dice"] = None
            st["winner"] = None
            st["auction"] = None
            st["trade"] = None
            st["awaiting"] = {"type": "jail"} if self._player(order[0])["jail"] else {"type": "roll"}
            st["turnActivity"] = time.time()
            self._log("Гра почалася! Стартовий капітал " + fmt(money), "start")
            self._log(f"Першим ходить {self._player(order[0])['name']}", "turn")
            self._bump()

    # ---------- money ----------

    def _charge(self, p, amount, to=None, reason="", split=None):
        st = self.state
        amount = int(amount)
        if amount <= 0:
            return True
        if p["money"] >= amount:
            p["money"] -= amount
            if to:
                creditor = self._player(to)
                creditor["money"] += amount
                self._log(f"{p['name']} платить {fmt(amount)} гравцю {creditor['name']} ({reason})", "money", p["id"])
            elif split:
                share = amount // max(1, len(split))
                for sid in split:
                    if sid != p["id"]:
                        self._player(sid)["money"] += share
                self._log(f"{p['name']} платить {fmt(amount)} гравцям ({reason})", "money", p["id"])
            else:
                self._log(f"{p['name']} платить у банк {fmt(amount)} ({reason})", "money", p["id"])
                if st["options"].get("parkingPot"):
                    st["pot"] = st.get("pot", 0) + amount
            return True
        p["debt"] = {"amount": amount, "to": to, "reason": reason, "split": split}
        self._log(f"{p['name']} винен {fmt(amount)} ({reason}) — треба продати/заставити майно", "debt", p["id"])
        st["awaiting"] = {"type": "debt"}
        return False

    def _settle_debt(self, p):
        st = self.state
        d = p["debt"]
        if not d or p["money"] < d["amount"]:
            return False
        p["money"] -= d["amount"]
        if d.get("to"):
            self._player(d["to"])["money"] += d["amount"]
            self._log(f"{p['name']} розрахувався: {fmt(d['amount'])}", "money", p["id"])
        elif d.get("split"):
            share = d["amount"] // max(1, len(d["split"]))
            for sid in d["split"]:
                if sid != p["id"]:
                    self._player(sid)["money"] += share
            self._log(f"{p['name']} розрахувався: {fmt(d['amount'])}", "money", p["id"])
        else:
            self._log(f"{p['name']} розрахувався з банком: {fmt(d['amount'])}", "money", p["id"])
            if st["options"].get("parkingPot"):
                st["pot"] = st.get("pot", 0) + d["amount"]
        p["debt"] = None
        return True

    # ---------- turn ----------

    def _roll_dice(self):
        d1 = self.rng.randint(1, 6)
        d2 = self.rng.randint(1, 6)
        self.state["dice"] = [d1, d2]
        return d1, d2

    def _exact_start_bonus(self):
        return 0 if self.state["options"].get("mode") == "classic" else 100

    def _move_by(self, p, steps, collect_go=True):
        pos = (p["pos"] + steps) % 40
        if collect_go and steps > 0 and (p["pos"] + steps) >= 40:
            p["money"] += 200
            self._log(f"{p['name']} проходить СТАРТ і отримує 200 ₴", "money", p["id"])
        p["pos"] = pos
        if collect_go and steps > 0 and pos == 0:
            bonus = self._exact_start_bonus()
            if bonus:
                p["money"] += bonus
                self._log(f"{p['name']} зупиняється точно на СТАРТі — бонус +{fmt(bonus)}", "money", p["id"])

    def _move_to(self, p, idx, collect_go=True):
        if collect_go and (idx < p["pos"] or idx == 0) and p["pos"] != 0:
            p["money"] += 200
            self._log(f"{p['name']} проходить СТАРТ і отримує 200 ₴", "money", p["id"])
        elif collect_go and p["pos"] == 0 and idx == 0:
            pass
        p["pos"] = idx
        if collect_go and idx == 0:
            bonus = self._exact_start_bonus()
            if bonus:
                p["money"] += bonus
                self._log(f"{p['name']} зупиняється точно на СТАРТі — бонус +{fmt(bonus)}", "money", p["id"])

    def _rent_for(self, tile, idx, dice_sum=7, multiplier=1, util_ten=False):
        st = self.state["tiles"][idx]
        owner = st["owner"]
        if owner is None or st["mortgaged"]:
            return 0
        rm = float(self.state["options"].get("rentMult", 1.0)) * float(self.state.get("rentBoost", 1.0))
        if tile["type"] == "street":
            if st["houses"] > 0:
                base = tile["rent"][st["houses"]]
            else:
                base = tile["rent"][0]
                if all(self.state["tiles"][i]["owner"] == owner for i in GROUP_TILES[tile["group"]]):
                    base *= 2
            return int(round(base * multiplier * rm))
        if tile["type"] == "rr":
            n = sum(1 for i in GROUP_TILES["rr"] if self.state["tiles"][i]["owner"] == owner)
            return int(round(tile["rent"][max(0, n - 1)] * multiplier * rm))
        if tile["type"] == "util":
            n = sum(1 for i in GROUP_TILES["util"] if self.state["tiles"][i]["owner"] == owner)
            mult = 10 if (util_ten or n == 2) else 4
            return int(round(mult * dice_sum * rm))
        return 0

    def _send_to_jail(self, p, reason="за правилами"):
        p["pos"] = 10
        p["jail"] = True
        p["jailTurns"] = 0
        self._log(f"{p['name']} вирушає до тюрми ({reason})", "jail", p["id"])
        self.state["awaiting"] = {"type": "endturn"}

    def _resolve_tile(self, p, idx, multiplier=1, dice_sum=7, depth=0, util_ten=False):
        st = self.state
        tile = self.board[idx]
        ts = st["tiles"][idx]
        t = tile["type"]
        if t in ("street", "rr", "util"):
            if ts["owner"] is None:
                st["awaiting"] = {"type": "buy", "tile": idx}
                self._log(f"{p['name']} може купити «{tile['name']}» за {fmt(tile['price'])}", "prop", p["id"])
                return
            if ts["owner"] == p["id"]:
                self._log(f"{p['name']} потрапляє на свою «{tile['name']}»", "move", p["id"])
                return
            if ts["mortgaged"]:
                self._log(f"«{tile['name']}» заставлена — рента не сплачується", "move", p["id"])
                return
            rent = self._rent_for(tile, idx, dice_sum=dice_sum, multiplier=multiplier, util_ten=util_ten)
            owner = self._player(ts["owner"])
            st["awaiting"] = {"type": "pay_rent", "tile": idx, "to": owner["id"], "amount": rent}
            self._log(f"{p['name']} має сплатити ренту {fmt(rent)} за «{tile['name']}» гравцю {owner['name']}", "rent", p["id"])
            return
        if t == "tax":
            self._charge(p, tile["amount"], reason=tile["name"])
            return
        if t == "chance":
            self._draw_card(p, "chance", depth)
            return
        if t == "chest":
            self._draw_card(p, "chest", depth)
            return
        if t == "casino":
            st["awaiting"] = {"type": "casino"}
            self._log(f"{p['name']} потрапляє до казино", "move", p["id"])
            return
        if t == "gotojail":
            self._send_to_jail(p, "клітинка «До тюрми»")
            return
        if t == "jail":
            self._log(f"{p['name']} відвідує тюрму", "move", p["id"])
            return
        if t == "parking":
            if st["options"].get("parkingPot") and st.get("pot", 0) > 0:
                p["money"] += st["pot"]
                self._log(f"{p['name']} забирає банк парковки: {fmt(st['pot'])}", "money", p["id"])
                st["pot"] = 0
            else:
                self._log(f"{p['name']} відпочиває на безкоштовній парковці", "move", p["id"])
            return

    def _theme_text(self, text):
        if self.theme != "brands":
            return text
        for old, new in BRAND_CARD_WORDS.items():
            text = text.replace(old, new)
        return text

    def _draw_card(self, p, deck_name, depth=0):
        st = self.state
        deck = st["decks"][deck_name]
        if not deck:
            self._log("Колода порожня", "info")
            return
        card = deck.pop(0)
        title = "Шанс" if deck_name == "chance" else "Громадська скарбниця"
        text = self._theme_text(card["text"])
        st["lastCard"] = {"deck": deck_name, "title": title, "text": text,
                          "pid": p["id"], "t": time.time()}
        self._log(f"{p['name']} — {title}: {text}", "card", p["id"])
        effect = card["do"]
        if effect["t"] != "getout":
            deck.append(card)
        kind = effect["t"]
        if kind == "move":
            idx = effect["to"]
            self._move_to(p, idx, collect_go=True)
            self._resolve_tile(p, idx, multiplier=2 if effect.get("double") else 1,
                               dice_sum=sum(st["dice"] or [3, 4]), depth=depth + 1)
        elif kind == "nearest":
            if effect["kind"] == "rr":
                idx = next(i for i in range(1, 41) if self.board[(p["pos"] + i) % 40]["type"] == "rr")
                idx = (p["pos"] + idx) % 40
                self._move_to(p, idx, collect_go=True)
                self._resolve_tile(p, idx, multiplier=2, depth=depth + 1)
            else:
                idx = next(i for i in range(1, 41) if self.board[(p["pos"] + i) % 40]["type"] == "util")
                idx = (p["pos"] + idx) % 40
                self._move_to(p, idx, collect_go=True)
                saved = st["dice"]
                d = self._roll_dice()
                self._resolve_tile(p, idx, dice_sum=sum(d), depth=depth + 1, util_ten=True)
                st["dice"] = saved
        elif kind == "back":
            p["pos"] = (p["pos"] - effect["n"]) % 40
            self._log(f"{p['name']} повертається на «{self.board[p['pos']]['name']}»", "move", p["id"])
            self._resolve_tile(p, p["pos"], depth=depth + 1)
        elif kind == "jail":
            self._send_to_jail(p, "картка")
        elif kind == "money":
            p["money"] += effect["amount"]
            self._log(f"{p['name']} отримує {fmt(effect['amount'])}", "money", p["id"])
        elif kind == "pay":
            self._charge(p, effect["amount"], reason="картка")
        elif kind == "getout":
            p["cards"] += 1
            p["getoutDecks"].append(deck_name)
            self._log(f"{p['name']} отримує картку звільнення з тюрми", "card", p["id"])
        elif kind == "repairs":
            houses = hotels = 0
            for i, t in enumerate(BOARD):
                if st["tiles"][i]["owner"] == p["id"]:
                    h = st["tiles"][i]["houses"]
                    if h == 5:
                        hotels += 1
                    else:
                        houses += h
            total = houses * effect["house"] + hotels * effect["hotel"]
            self._log(f"{p['name']}: {houses} будинків і {hotels} готелів — ремонт на {fmt(total)}", "money", p["id"])
            if total > 0:
                self._charge(p, total, reason="ремонт")
        elif kind == "pay_each":
            others = [x["id"] for x in self._alive() if x["id"] != p["id"]]
            total = effect["amount"] * len(others)
            self._charge(p, total, reason="платіж кожному гравцю", split=others)
        elif kind == "collect_each":
            for other in self._alive():
                if other["id"] == p["id"]:
                    continue
                amount = min(effect["amount"], other["money"])
                other["money"] -= amount
                p["money"] += amount
            self._log(f"{p['name']} збирає по {fmt(effect['amount'])} з кожного", "money", p["id"])

    def _after_resolution(self, p):
        st = self.state
        aw = st["awaiting"]
        if aw and aw.get("type") in ("buy", "pay_rent"):
            return
        if p["debt"]:
            st["awaiting"] = {"type": "debt"}
            return
        d = st["dice"]
        if d and d[0] == d[1] and not st.get("noExtra") and not p["jail"]:
            st["awaiting"] = {"type": "roll"}
            self._log(f"Дубль — {p['name']} кидає ще раз", "turn", p["id"])
        else:
            st["awaiting"] = {"type": "endturn"}

    def _on_turn_end(self, p):
        """Credit countdown and mortgage deadlines for the player ending this turn."""
        st = self.state
        cr = p.get("credit")
        if cr:
            cr["turns"] -= 1
            if cr["turns"] <= 0:
                due = cr["due"]
                p["credit"] = None
                p["creditCool"] = 5
                if p["money"] >= due:
                    p["money"] -= due
                    self._log(f"{p['name']} автоматично погашає кредит {fmt(due)}", "money", p["id"])
                else:
                    p["debt"] = {"amount": due, "to": None}
                    st["awaiting"] = {"type": "debt"}
                    self._log(f"{p['name']} не зміг погасити кредит {fmt(due)} — борг банку", "debt", p["id"])
        if p.get("creditCool", 0) > 0:
            p["creditCool"] -= 1
        for i, ts in enumerate(st["tiles"]):
            if ts.get("owner") != p["id"] or not ts.get("mortgaged"):
                continue
            left = ts.get("mortgageLeft")
            if left is None:
                continue
            left -= 1
            if left <= 0:
                name = self.board[i]["name"]
                ts["owner"] = None
                ts["mortgaged"] = False
                ts["mortgageLeft"] = None
                ts["houses"] = 0
                self._log(f"{p['name']} втрачає «{name}» через завершення строку застави", "mortgage", p["id"])
            else:
                ts["mortgageLeft"] = left
        return bool(p["debt"])

    def _end_turn(self, p):
        st = self.state
        if self._on_turn_end(p):
            return
        st["doubles"] = 0
        st["dice"] = None
        st["noExtra"] = False
        st["lastCard"] = None
        alive = len(self._alive())
        st["turns"] += 1
        if st["options"].get("accel") and alive and st["turns"] % alive == 0:
            st["round"] += 1
            if st["round"] % 5 == 0:
                st["rentBoost"] = round(st["rentBoost"] + 0.1, 2)
                self._log(f"Коло {st['round']}: рента ×{st['rentBoost']:.2f}", "info")
        nxt = self._next_alive(p["id"])
        st["turn"] = nxt
        np = self._player(nxt)
        st["awaiting"] = {"type": "jail"} if np["jail"] else {"type": "roll"}
        st["turnActivity"] = time.time()
        self._log(f"Хід переходить до {np['name']}", "turn", nxt)

    # ---------- actions ----------

    def act(self, pid, action):
        with self.cond:
            cur = self._cur()
            if cur and cur["id"] == pid and self.state["phase"] == "playing":
                self.state["turnActivity"] = time.time()
            try:
                self._apply(pid, action)
            except RulesError:
                raise
            cur = self._cur()
            if cur and cur["debt"] and self.state["phase"] == "playing":
                self.state["awaiting"] = {"type": "debt"}
            self._bump()

    def _apply(self, pid, a):
        st = self.state
        t = a.get("type")
        if t == "chat":
            p = self._player(pid)
            text = str(a.get("text", ""))[:300].strip()
            if text:
                st["chatSeq"] += 1
                st["chat"].append({"id": st["chatSeq"], "pid": pid, "name": p["name"],
                                   "color": p["hex"], "text": text, "t": time.time()})
                if len(st["chat"]) > 200:
                    st["chat"] = st["chat"][-100:]
            return

        if t == "start":
            return self.start(pid)

        if t == "kick":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            target = a.get("pid")
            if target == pid:
                raise RulesError("Себе не можна")
            if st["phase"] != "lobby":
                raise RulesError("Видалити можна лише в лобі")
            self._player(target)
            self.remove_player(target)
            return

        if t == "add_bot":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "lobby":
                raise RulesError("Ботів можна додавати лише в лобі")
            self.add_player("Бот", "bot-" + str(self.counter), bot=True)
            return

        if t == "remove_bot":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            bots = [x for x in st["players"] if x["bot"]]
            if bots:
                self.remove_player(bots[-1]["id"])
            return

        if t == "leave":
            self.remove_player(pid)
            return

        if t == "set_mode":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "lobby":
                raise RulesError("Пізно змінювати")
            mode = str(a.get("mode", "company"))
            if mode not in ("company", "classic"):
                raise RulesError("Невідомий режим")
            st["options"]["mode"] = mode
            return

        if t == "set_theme":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "lobby":
                raise RulesError("Пізно змінювати")
            theme = str(a.get("theme", "brands"))
            if theme not in ("brands", "classic"):
                raise RulesError("Невідома тема")
            st["options"]["theme"] = theme
            self.theme = theme
            self.board = BOARD_BRANDS if theme == "brands" else BOARD
            return

        if t == "set_parking":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "lobby":
                raise RulesError("Пізно змінювати")
            st["options"]["parkingPot"] = bool(a.get("value"))
            return

        if t == "set_timer":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "lobby":
                raise RulesError("Пізно змінювати")
            try:
                value = int(a.get("value", 60))
            except (TypeError, ValueError):
                raise RulesError("Невірний таймер")
            if value not in (0, 30, 60, 90):
                raise RulesError("Невірний таймер")
            st["options"]["turnTimer"] = value
            return

        if t == "casino_bet":
            p = self._require_turn(pid)
            aw = st["awaiting"] or {}
            if aw.get("type") != "casino":
                raise RulesError("Зараз не казино")
            try:
                bet = int(a.get("bet", 0))
            except (TypeError, ValueError):
                raise RulesError("Невірна ставка")
            if bet not in (100, 200, 500):
                raise RulesError("Ставка: 100, 200 або 500 ₴")
            if p["money"] < bet:
                raise RulesError("Недостатньо грошей")

            kind = str(a.get("kind") or a.get("color") or "")
            number = None
            if kind == "number":
                try:
                    number = int(a.get("number", -1))
                except (TypeError, ValueError):
                    raise RulesError("Невірне число")
                if number < 0 or number > 36:
                    raise RulesError("Число від 0 до 36")
            elif kind not in ("red", "black", "even", "odd", "low", "high",
                              "dozen1", "dozen2", "dozen3"):
                raise RulesError("Оберіть ставку")

            n = self.rng.randint(0, 36)
            red = 1 <= n <= 18
            shown = "зеро" if n == 0 else ("червоне" if red else "чорне")

            if kind == "number":
                win = n == number
                net = bet * 35 if win else -bet
                label = f"число {number}"
            elif kind == "red":
                win = red
                net = bet if win else -bet
                label = "червоне"
            elif kind == "black":
                win = 19 <= n <= 36
                net = bet if win else -bet
                label = "чорне"
            elif kind == "even":
                win = n != 0 and n % 2 == 0
                net = bet if win else -bet
                label = "парне"
            elif kind == "odd":
                win = n % 2 == 1
                net = bet if win else -bet
                label = "непарне"
            elif kind == "low":
                win = 1 <= n <= 18
                net = bet if win else -bet
                label = "1–18"
            elif kind == "high":
                win = 19 <= n <= 36
                net = bet if win else -bet
                label = "19–36"
            else:
                lo = {"dozen1": 1, "dozen2": 13, "dozen3": 25}[kind]
                win = lo <= n <= lo + 11
                net = bet * 2 if win else -bet
                label = {"dozen1": "1-ша дюжина", "dozen2": "2-га дюжина",
                         "dozen3": "3-тя дюжина"}[kind]

            p["money"] += net
            if win:
                p["casinoWins"] = p.get("casinoWins", 0) + 1
                self._log(f"{p['name']} ставить {fmt(bet)} на {label}: {n} {shown} — виграш +{fmt(net)}", "money", p["id"])
            else:
                self._log(f"{p['name']} ставить {fmt(bet)} на {label}: {n} {shown} — програш −{fmt(-net)}", "money", p["id"])
            st["awaiting"] = {"type": "endturn"}
            return

        if t == "casino_skip":
            p = self._require_turn(pid)
            aw = st["awaiting"] or {}
            if aw.get("type") != "casino":
                raise RulesError("Зараз не казино")
            self._log(f"{p['name']} проходить повз казино", "move", p["id"])
            st["awaiting"] = {"type": "endturn"}
            return

        if t == "pay_rent":
            p = self._require_turn(pid)
            aw = st["awaiting"] or {}
            if aw.get("type") != "pay_rent":
                raise RulesError("Зараз немає ренти")
            idx = aw.get("tile")
            to = aw.get("to")
            amount = int(aw.get("amount") or 0)
            owner = self._player(to) if to else None
            name = self.board[idx]["name"] if idx is not None else ""
            self._charge(p, amount, to=to, reason=f"рента «{name}»")
            self._log(
                f"{p['name']} сплачує ренту {fmt(amount)} за «{name}»"
                + (f" гравцю {owner['name']}" if owner else ""),
                "rent", p["id"])
            if p["debt"]:
                st["awaiting"] = {"type": "debt"}
                return
            st["awaiting"] = {"type": "endturn"}
            self._after_resolution(p)
            return

        if t == "take_credit":
            p = self._player(pid)
            if st["phase"] != "playing" or p["bankrupt"]:
                raise RulesError("Зараз не можна")
            if p.get("credit"):
                raise RulesError("Уже є кредит")
            if p.get("creditCool", 0) > 0:
                raise RulesError(f"Новий кредит через {p['creditCool']} ходів")
            p["money"] += 500
            p["credit"] = {"amount": 500, "due": 600, "turns": 15}
            self._log(f"{p['name']} бере кредит 500 ₴ — повернути 600 ₴ за 15 ходів", "money", p["id"])
            return

        if t == "repay_credit":
            p = self._player(pid)
            cr = p.get("credit")
            if not cr:
                raise RulesError("Кредиту немає")
            due = cr["due"]
            if p["money"] < due:
                raise RulesError(f"Потрібно {fmt(due)}")
            p["money"] -= due
            p["credit"] = None
            p["creditCool"] = 5
            self._log(f"{p['name']} погашає кредит {fmt(due)}", "money", p["id"])
            return

        if t == "skip_turn":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "playing":
                raise RulesError("Гра не йде")
            if st["auction"]:
                raise RulesError("Спочатку завершіть аукціон")
            cur = self._cur()
            if not cur:
                raise RulesError("Немає активного гравця")
            if cur["id"] == pid:
                raise RulesError("Це ваш хід — грайте")
            st["trade"] = None
            if cur["debt"]:
                self._bankrupt(cur, cur["debt"].get("to"))
            else:
                self._log(f"Власник пропустив хід {cur['name']}", "turn", cur["id"])
                self._end_turn(cur)
            return

        if t == "restart":
            if st["host"] != pid:
                raise RulesError("Лише власник кімнати")
            if st["phase"] != "ended":
                raise RulesError("Партія ще триває")
            st["phase"] = "lobby"
            st["tiles"] = [{"owner": None, "houses": 0, "mortgaged": False} for _ in BOARD]
            st["housesLeft"] = 32
            st["hotelsLeft"] = 12
            st["turn"] = None
            st["awaiting"] = None
            st["winner"] = None
            st["auction"] = None
            st["trade"] = None
            st["lastCard"] = None
            st["dice"] = None
            st["doubles"] = 0
            st["startedAt"] = None
            st["pot"] = 0
            st["round"] = 1
            st["turns"] = 0
            st["rentBoost"] = 1.0
            st["log"] = []
            st["turnActivity"] = None
            for p in st["players"]:
                p["money"] = 0
                p["pos"] = 0
                p["jail"] = False
                p["jailTurns"] = 0
                p["cards"] = 0
                p["bankrupt"] = False
                p["debt"] = None
                p["credit"] = None
                p["creditCool"] = 0
                p["missions"] = []
                p["trades"] = 0
                p["casinoWins"] = 0
            self._log("Нова гра — повертаємось у лобі", "start")
            return

        if t == "roll":
            p = self._require_turn(pid)
            aw = st["awaiting"]
            if aw["type"] not in ("roll", "jail"):
                raise RulesError("Зараз не можна кидати кубики")
            if p["debt"]:
                raise RulesError("Спочатку розрахуйтеся")
            if p["jail"]:
                return self._jail_roll(p)
            st["noExtra"] = False
            d1, d2 = self._roll_dice()
            if d1 == d2:
                st["doubles"] += 1
            total = d1 + d2
            self._log(f"{p['name']} кидає {d1} + {d2} = {total}", "roll", p["id"])
            if st["doubles"] >= 3:
                self._log(f"Третій дубль поспіль!", "roll", p["id"])
                self._send_to_jail(p, "три дублі поспіль")
                return
            self._move_by(p, total)
            self._log(f"{p['name']} йде на «{self.board[p['pos']]['name']}»", "move", p["id"])
            self._resolve_tile(p, p["pos"], dice_sum=total)
            self._after_resolution(p)
            return

        if t == "jail_pay":
            p = self._require_turn(pid)
            if not p["jail"]:
                raise RulesError("Ви не в тюрмі")
            if not st["awaiting"] or st["awaiting"].get("type") != "jail":
                raise RulesError("Зараз не можна платити заставу")
            if p["money"] < JAIL_FINE:
                raise RulesError("Не вистачає грошей на заставу")
            p["money"] -= JAIL_FINE
            if st["options"].get("parkingPot"):
                st["pot"] = st.get("pot", 0) + JAIL_FINE
            p["jail"] = False
            p["jailTurns"] = 0
            st["awaiting"] = {"type": "roll"}
            self._log(f"{p['name']} платить заставу 50 ₴ і виходить з тюрми", "jail", p["id"])
            return

        if t == "jail_card":
            p = self._require_turn(pid)
            if not p["jail"]:
                raise RulesError("Ви не в тюрмі")
            if not st["awaiting"] or st["awaiting"].get("type") != "jail":
                raise RulesError("Зараз не можна використати картку")
            if p["cards"] < 1:
                raise RulesError("Немає картки звільнення")
            p["cards"] -= 1
            decks = p.get("getoutDecks") or []
            deck = decks.pop() if decks else "chance"
            p["getoutDecks"] = decks
            p["jail"] = False
            p["jailTurns"] = 0
            if deck == "chest":
                st["decks"]["chest"].append(CHEST[4])
            else:
                st["decks"]["chance"].append(CHANCE[7])
            st["awaiting"] = {"type": "roll"}
            self._log(f"{p['name']} використовує картку звільнення", "jail", p["id"])
            return

        if t == "buy":
            p = self._require_turn(pid)
            aw = self._aw("buy")
            idx = aw["tile"]
            price = self.board[idx]["price"]
            if p["money"] < price:
                raise RulesError("Не вистачає грошей — лише аукціон")
            p["money"] -= price
            st["tiles"][idx]["owner"] = p["id"]
            self._log(f"{p['name']} купує «{self.board[idx]['name']}» за {fmt(price)}", "prop", p["id"])
            st["awaiting"] = {"type": "endturn"}
            self._after_resolution(p)
            return

        if t == "decline_buy":
            p = self._require_turn(pid)
            aw = self._aw("buy")
            idx = aw["tile"]
            self._log(f"{p['name']} відмовляється від купівлі «{self.board[idx]['name']}» — аукціон", "prop", p["id"])
            self._start_auction(p, idx)
            return

        if t == "bid":
            return self._auction_bid(pid, int(a.get("amount", 0)))
        if t == "auction_pass":
            return self._auction_pass(pid)

        if t == "end_turn":
            p = self._require_turn(pid)
            aw = st["awaiting"]
            if aw["type"] not in ("endturn",):
                raise RulesError("Спочатку завершіть дію")
            self._end_turn(p)
            return

        if t == "build":
            p = self._require(pid)
            self._build(p, int(a.get("tile", -1)))
            return
        if t == "sell_house":
            p = self._require(pid)
            self._sell_house(p, int(a.get("tile", -1)))
            return
        if t == "mortgage":
            p = self._require(pid)
            self._mortgage(p, int(a.get("tile", -1)))
            return
        if t == "unmortgage":
            p = self._require(pid)
            self._unmortgage(p, int(a.get("tile", -1)))
            return

        if t == "bankrupt":
            p = self._require(pid)
            cred = p["debt"]["to"] if p["debt"] else None
            self._bankrupt(p, cred)
            self._bump()
            return

        if t == "trade_propose":
            return self._trade_propose(pid, a)
        if t == "trade_respond":
            return self._trade_respond(pid, bool(a.get("accept")), a.get("trade_id"))
        if t == "trade_cancel":
            return self._trade_cancel(pid)

        raise RulesError("Невідома дія")

    # ---------- jail ----------

    def _jail_roll(self, p):
        st = self.state
        d1, d2 = self._roll_dice()
        total = d1 + d2
        st["noExtra"] = True
        self._log(f"{p['name']} в тюрьме кидає {d1} + {d2} = {total}", "roll", p["id"])
        if d1 == d2:
            p["jail"] = False
            p["jailTurns"] = 0
            self._log(f"Дубль! {p['name']} виходить з тюрми", "jail", p["id"])
            self._move_by(p, total)
            self._log(f"{p['name']} йде на «{self.board[p['pos']]['name']}»", "move", p["id"])
            self._resolve_tile(p, p["pos"], dice_sum=total)
            self._after_resolution(p)
            return
        p["jailTurns"] += 1
        if p["jailTurns"] >= 3:
            if self._charge(p, JAIL_FINE, reason="залог"):
                p["jail"] = False
                p["jailTurns"] = 0
                self._log(f"Третя невдача — {p['name']} платить 50 ₴ і йде", "jail", p["id"])
                self._move_by(p, total)
                self._log(f"{p['name']} йде на «{self.board[p['pos']]['name']}»", "move", p["id"])
                self._resolve_tile(p, p["pos"], dice_sum=total)
                self._after_resolution(p)
            else:
                self._log(f"{p['name']} не може сплатити заставу — борг 50 ₴", "jail", p["id"])
            return
        self._log(f"{p['name']} залишається в тюрмі (спроба {p['jailTurns']} з 3)", "jail", p["id"])
        self._after_resolution(p)

    # ---------- auction ----------

    def _start_auction(self, p, idx):
        st = self.state
        alive = [x["id"] for x in self._alive()]
        start = self._next_alive(p["id"])
        st["awaiting"] = {"type": "auction"}
        st["auction"] = {
            "tile": idx,
            "bid": 0,
            "leader": None,
            "turn": start,
            "active": alive,
            "deadline": time.time() + AUCTION_TIMEOUT,
            "started": time.time(),
        }
        self._log(f"Аукціон: «{self.board[idx]['name']}». Першим ставить {self._player(start)['name']}", "auction")

    def _auction_finish(self, winner=None):
        st = self.state
        auc = st["auction"]
        idx = auc["tile"]
        if winner and auc["bid"] > 0:
            w = self._player(winner)
            if w["money"] < auc["bid"]:
                self._log(f"{w['name']} не має достатньо коштів — лот не продано", "auction", winner)
                winner = None
        if winner and auc["bid"] > 0:
            st["tiles"][idx]["owner"] = winner
            self._player(winner)["money"] -= auc["bid"]
            self._log(f"{self._player(winner)['name']} виграє «{self.board[idx]['name']}» за {fmt(auc['bid'])}", "auction", winner)
        else:
            self._log(f"«{self.board[idx]['name']}» залишається в банку", "auction")
        st["auction"] = None
        cur = self._cur()
        if cur:
            self._after_resolution(cur)

    def _auction_advance(self):
        st = self.state
        auc = st["auction"]
        alive_ids = {p["id"] for p in st["players"] if not p["bankrupt"]}
        active = [x for x in auc["active"] if x in alive_ids]
        auc["active"] = active
        if not active:
            return self._auction_finish(None)
        if len(active) == 1:
            only = active[0]
            if auc["bid"] > 0:
                return self._auction_finish(auc["leader"] or only)
            # last player gets a chance to bid before the lot is dropped
            auc["turn"] = only
            auc["deadline"] = time.time() + AUCTION_TIMEOUT
            return
        nxt = self._next_in(active, auc["turn"])
        auc["turn"] = nxt
        auc["deadline"] = time.time() + AUCTION_TIMEOUT

    def _next_in(self, ids, pid):
        if pid in ids:
            return ids[(ids.index(pid) + 1) % len(ids)]
        return ids[0]

    def _auction_bid(self, pid, amount):
        st = self.state
        self._require(pid)
        auc = st["auction"]
        if not auc:
            raise RulesError("Аукціону немає")
        if auc["turn"] != pid:
            raise RulesError("Зараз не ваша ставка")
        p = self._player(pid)
        min_bid = (auc["bid"] + AUCTION_STEP) if auc["bid"] > 0 else AUCTION_STEP
        if amount < min_bid:
            raise RulesError(f"Мінімальна ставка {min_bid} ₴")
        if amount > p["money"]:
            raise RulesError("Не вистачає грошей")
        auc["bid"] = amount
        auc["leader"] = pid
        self._log(f"{p['name']} ставить {fmt(amount)}", "auction", pid)
        self._auction_advance()

    def _auction_pass(self, pid):
        st = self.state
        self._require(pid)
        auc = st["auction"]
        if not auc:
            raise RulesError("Аукціону немає")
        p = self._player(pid)
        if auc["turn"] == pid:
            self._log(f"{p['name']} пасує", "auction", pid)
            auc["active"] = [x for x in auc["active"] if x != pid]
            self._auction_advance()
        else:
            raise RulesError("Зараз не ваша черга")

    # ---------- houses / mortgage ----------

    def _group_of(self, idx):
        return self.board[idx].get("group")

    def _owns_group(self, pid, group):
        return all(self.state["tiles"][i]["owner"] == pid for i in GROUP_TILES[group])

    def _build(self, p, idx):
        st = self.state
        if not (0 <= idx < 40):
            raise RulesError("Невірна клітинка")
        tile = self.board[idx]
        if tile["type"] != "street":
            raise RulesError("Будинки можна будувати лише на вулицях")
        stt = st["tiles"][idx]
        if stt["owner"] != p["id"]:
            raise RulesError("Це не ваша вулиця")
        group = tile["group"]
        if not self._owns_group(p["id"], group):
            raise RulesError("Спочатку зберіть усю кольорову групу")
        if any(st["tiles"][i]["mortgaged"] for i in GROUP_TILES[group]):
            raise RulesError("У групі є заставлені вулиці")
        houses = [st["tiles"][i]["houses"] for i in GROUP_TILES[group]]
        if stt["houses"] >= 5:
            raise RulesError("Уже готель")
        if stt["houses"] > min(houses):
            raise RulesError("Будувати треба рівномірно")
        if stt["houses"] == 4:
            if st["hotelsLeft"] < 1:
                raise RulesError("У банку закінчилися готелі")
        else:
            if st["housesLeft"] < 1:
                raise RulesError("У банку закінчилися будинки")
        if p["money"] < self._house_cost(tile, stt["houses"]):
            raise RulesError("Не вистачає грошей на стройку")
        cost = self._house_cost(tile, stt["houses"])
        p["money"] -= cost
        if stt["houses"] == 4:
            stt["houses"] = 5
            st["housesLeft"] += 4
            st["hotelsLeft"] -= 1
            self._log(f"{p['name']} будує готель на «{tile['name']}» за {fmt(cost)}", "build", p["id"])
        else:
            stt["houses"] += 1
            st["housesLeft"] -= 1
            self._log(f"{p['name']} будує будинок на «{tile['name']}» за {fmt(cost)}", "build", p["id"])

    def _house_cost(self, tile, houses):
        return int(tile["house"]) * (int(houses) + 1)

    def _sell_house(self, p, idx):
        st = self.state
        tile = self.board[idx]
        stt = st["tiles"][idx]
        if stt["owner"] != p["id"] or stt["houses"] == 0:
            raise RulesError("Продавати нічого")
        group = tile["group"]
        houses = [st["tiles"][i]["houses"] for i in GROUP_TILES[group]]
        if stt["houses"] < max(houses):
            raise RulesError("Спочатку продайте будинки там, де їх більше")
        refund = self._house_cost(tile, stt["houses"] - 1)
        if st["options"].get("mode") == "classic":
            refund //= 2
        if stt["houses"] == 5:
            if st["housesLeft"] < 4:
                raise RulesError("У банку не вистачає будинків для обміну готелю")
            stt["houses"] = 4
            st["housesLeft"] -= 4
            st["hotelsLeft"] += 1
            self._log(f"{p['name']} продає готель на «{tile['name']}» (+{fmt(refund)})", "build", p["id"])
        else:
            stt["houses"] -= 1
            st["housesLeft"] += 1
            self._log(f"{p['name']} продає будинок на «{tile['name']}» (+{fmt(refund)})", "build", p["id"])
        p["money"] += refund
        if p["debt"]:
            if self._settle_debt(p):
                st["awaiting"] = {"type": "endturn"}
                self._after_resolution(p)

    def _mortgage(self, p, idx):
        st = self.state
        tile = self.board[idx]
        stt = st["tiles"][idx]
        if stt["owner"] != p["id"]:
            raise RulesError("Не ваша власність")
        if stt["mortgaged"]:
            raise RulesError("Уже заставлено")
        group = tile.get("group")
        if group and any(st["tiles"][i]["houses"] > 0 for i in GROUP_TILES[group]):
            raise RulesError("Спочатку продайте будинки в цій групі")
        stt["mortgaged"] = True
        stt["mortgageLeft"] = 10
        amount = tile["price"] // 2
        p["money"] += amount
        self._log(f"{p['name']} заставляє «{tile['name']}» (+{fmt(amount)})", "mortgage", p["id"])
        if p["debt"]:
            if self._settle_debt(p):
                self._after_resolution(p)

    def _unmortgage(self, p, idx):
        st = self.state
        tile = self.board[idx]
        stt = st["tiles"][idx]
        if stt["owner"] != p["id"] or not stt["mortgaged"]:
            raise RulesError("Нічого викуповувати")
        cost = int(round(tile["price"] * 0.6))
        if p["money"] < cost:
            raise RulesError(f"Потрібно {fmt(cost)}")
        p["money"] -= cost
        stt["mortgaged"] = False
        stt["mortgageLeft"] = None
        self._log(f"{p['name']} викуповує «{tile['name']}» за {fmt(cost)}", "mortgage", p["id"])

    # ---------- bankruptcy ----------

    def _bankrupt(self, p, creditor_id, quit_game=False):
        st = self.state
        if p["bankrupt"]:
            return
        for i, ts in enumerate(st["tiles"]):
            if ts["owner"] != p["id"]:
                continue
            if ts["houses"] > 0:
                tile = self.board[i]
                n = ts["houses"]
                refund = tile["house"] * (n * (n + 1) // 2) // 2
                p["money"] += refund
                if ts["houses"] == 5:
                    st["hotelsLeft"] += 1
                else:
                    st["housesLeft"] += ts["houses"]
                ts["houses"] = 0
            if creditor_id:
                ts["owner"] = creditor_id
            else:
                ts["owner"] = None
                ts["mortgaged"] = False
        creditor = self._player(creditor_id) if creditor_id else None
        if creditor:
            creditor["money"] += p["money"]
        p["money"] = 0
        p["debt"] = None
        p["bankrupt"] = True
        p["jail"] = False
        reason = "вийшов з гри" if quit_game else "банкрут"
        if creditor:
            self._log(f"{p['name']} збанкрутував. Усе майно переходить до {creditor['name']} ({reason})", "bankrupt", p["id"])
        else:
            self._log(f"{p['name']} збанкрутував, майно повернулося до банку ({reason})", "bankrupt", p["id"])
        alive = self._alive()
        if len(alive) == 1:
            st["phase"] = "ended"
            st["winner"] = alive[0]["id"]
            st["awaiting"] = None
            st["log"].append({"id": len(st["log"]) + 1, "text": f"🏆 {alive[0]['name']} перемагає!", "kind": "win", "pid": alive[0]["id"], "t": time.time()})
        elif len(alive) == 0:
            st["phase"] = "ended"
            st["winner"] = None
        elif st["turn"] == p["id"]:
            self._end_turn(p)

    # ---------- trade ----------

    def _trade_propose(self, pid, a):
        st = self.state
        p = self._require(pid)
        if p["debt"]:
            raise RulesError("Спочатку розрахуйтеся")
        if st["auction"]:
            raise RulesError("Триває аукціон")
        if st.get("tradeKey") != st["turn"]:
            st["tradeKey"] = st["turn"]
            st["tradeCount"] = 0
        if st.get("tradeCount", 0) >= MAX_TRADES_TURN:
            raise RulesError(f"Не більше {MAX_TRADES_TURN} обмінів за хід")
        target = a.get("to")
        if not target or target == pid:
            raise RulesError("Виберіть гравця")
        tp = self._player(target)
        if tp["bankrupt"]:
            raise RulesError("Цей гравець вибув")
        give = a.get("give") or {}
        want = a.get("want") or {}
        g_tiles = [int(x) for x in give.get("tiles", [])]
        w_tiles = [int(x) for x in want.get("tiles", [])]
        g_money = int(give.get("money", 0) or 0)
        w_money = int(want.get("money", 0) or 0)
        if g_money < 0 or w_money < 0:
            raise RulesError("Невірна сума")
        for i in g_tiles:
            if st["tiles"][i]["owner"] != pid:
                raise RulesError("Ви не володієте цією клітинкою")
            self._check_tradeable(i)
        for i in w_tiles:
            if st["tiles"][i]["owner"] != target:
                raise RulesError("Цей гравець не володіє клітинкою")
            self._check_tradeable(i)
        if g_money > p["money"] or w_money > tp["money"]:
            raise RulesError("Не вистачає грошей")
        if not g_tiles and not w_tiles and not g_money and not w_money:
            raise RulesError("Порожній обмін")
        st["trade"] = {
            "id": self.trade_seq + 1,
            "from": pid,
            "to": target,
            "give": {"tiles": g_tiles, "money": g_money},
            "want": {"tiles": w_tiles, "money": w_money},
            "deadline": time.time() + TRADE_TIMEOUT,
        }
        self.trade_seq += 1
        st["tradeCount"] = st.get("tradeCount", 0) + 1
        self._log(f"{p['name']} пропонує обмін гравцю {tp['name']}", "trade", pid)

    def _check_tradeable(self, idx):
        tile = self.board[idx]
        group = tile.get("group")
        if group:
            if any(self.state["tiles"][i]["houses"] > 0 for i in GROUP_TILES[group]):
                raise RulesError("Спочатку продайте будинки в цій групі")

    def _trade_respond(self, pid, accept, trade_id=None):
        st = self.state
        tr = st["trade"]
        if not tr:
            raise RulesError("Обміну немає")
        if trade_id is not None and tr.get("id") != trade_id:
            raise RulesError("Пропозиція вже неактуальна")
        if tr["to"] != pid:
            raise RulesError("Ця пропозиція не вам")
        if st["phase"] != "playing":
            st["trade"] = None
            raise RulesError("Гра не йде")
        frm = self._player(tr["from"])
        to = self._player(tr["to"])
        if frm["bankrupt"] or to["bankrupt"]:
            st["trade"] = None
            raise RulesError("Один з учасників обміну вибув")
        if accept:
            for i in tr["give"]["tiles"] + tr["want"]["tiles"]:
                self._check_tradeable(i)
            for i in tr["give"]["tiles"]:
                if st["tiles"][i]["owner"] != frm["id"]:
                    st["trade"] = None
                    raise RulesError("Пропозиція застаріла")
            for i in tr["want"]["tiles"]:
                if st["tiles"][i]["owner"] != to["id"]:
                    st["trade"] = None
                    raise RulesError("Пропозиція застаріла")
            if tr["give"]["money"] > frm["money"]:
                st["trade"] = None
                raise RulesError("В ініціатора не вистачає грошей")
            if tr["want"]["money"] > to["money"]:
                st["trade"] = None
                raise RulesError("Не вистачає грошей")

            def mortgage_fee(ids):
                return sum(int(round(self.board[i]["price"] * 0.05))
                           for i in ids if st["tiles"][i]["mortgaged"])

            fee_to = mortgage_fee(tr["give"]["tiles"])
            fee_frm = mortgage_fee(tr["want"]["tiles"])
            to_after = to["money"] + tr["give"]["money"] - tr["want"]["money"]
            frm_after = frm["money"] - tr["give"]["money"] + tr["want"]["money"]
            if to_after < fee_to or frm_after < fee_frm:
                st["trade"] = None
                raise RulesError("Не вистачає грошей на проценти за заставою")

            for i in tr["give"]["tiles"]:
                st["tiles"][i]["owner"] = to["id"]
            for i in tr["want"]["tiles"]:
                st["tiles"][i]["owner"] = frm["id"]
            frm["money"] -= tr["give"]["money"]
            to["money"] += tr["give"]["money"]
            to["money"] -= tr["want"]["money"]
            frm["money"] += tr["want"]["money"]
            if fee_to:
                to["money"] -= fee_to
                self._log(f"{to['name']} сплачує {fmt(fee_to)} процентів за заставу", "mortgage", to["id"])
            if fee_frm:
                frm["money"] -= fee_frm
                self._log(f"{frm['name']} сплачує {fmt(fee_frm)} процентів за заставу", "mortgage", frm["id"])
            self._log(f"Обмін відбувся: {frm['name']} ↔ {to['name']}", "trade", pid)
            frm["trades"] = frm.get("trades", 0) + 1
            to["trades"] = to.get("trades", 0) + 1
            st["trade"] = None
        else:
            st["trade"] = None
            self._log(f"{to['name']} відхилив обмін", "trade", pid)

    def _trade_cancel(self, pid):
        st = self.state
        tr = st["trade"]
        if not tr:
            return
        if pid not in (tr["from"], tr["to"]):
            raise RulesError("Це не ваш обмін")
        st["trade"] = None
        self._log("Пропозицію обміну скасовано", "trade")

    # ---------- timers / bots ----------

    def tick(self):
        """Called by the server ~3 times per second: auctions, timeouts, bots."""
        with self.cond:
            st = self.state
            changed = False
            now = time.time()
            if st["phase"] == "playing":
                auc = st["auction"]
                if auc:
                    alive_ids = {p["id"] for p in st["players"] if not p["bankrupt"]}
                    active = [x for x in auc["active"] if x in alive_ids]
                    if active != auc["active"] or auc["turn"] not in active:
                        auc["active"] = active
                        self._auction_advance()
                        changed = True
                    if st["auction"]:
                        auc = st["auction"]
                        pl = self._player(auc["turn"])
                        act = None
                        if pl["bot"] and now - st["updated"] > 0.7:
                            act = self._bot_choice(pl) or {"type": "auction_pass"}
                        elif now > auc["deadline"]:
                            act = {"type": "auction_pass"}
                        if act:
                            try:
                                self._apply(pl["id"], act)
                            except RulesError:
                                try:
                                    self._auction_pass(pl["id"])
                                except RulesError:
                                    pass
                            changed = True
                tr = st["trade"]
                if tr and now > tr["deadline"]:
                    st["trade"] = None
                    self._log("Пропозиція обміну прострочена", "trade")
                    changed = True
                cur = self._cur()
                if cur and cur["debt"] and cur["money"] >= cur["debt"]["amount"]:
                    self._settle_debt(cur)
                    self._after_resolution(cur)
                    changed = True
                if cur and cur["bot"] and not st["auction"]:
                    if now - st["updated"] > 0.7:
                        act = self._bot_choice(cur)
                        if act:
                            try:
                                self._apply(cur["id"], act)
                            except RulesError as e:
                                self._log(f"Бот: {e}", "info")
                                aw = st["awaiting"] or {}
                                try:
                                    if aw.get("type") == "buy":
                                        self._apply(cur["id"], {"type": "decline_buy"})
                                    elif aw.get("type") in ("roll", "jail") and not cur["debt"]:
                                        self._apply(cur["id"], {"type": "roll"})
                                    elif aw.get("type") == "debt":
                                        self._bankrupt(cur, cur["debt"]["to"] if cur["debt"] else None)
                                    else:
                                        self._end_turn(cur)
                                except RulesError:
                                    pass
                            changed = True

                limit = int(st["options"].get("turnTimer") or 0)
                if limit > 0 and cur and not cur["bot"]:
                    idle = now - (st.get("turnActivity") or now)
                    if cur["debt"]:
                        if idle > limit * 2:
                            self._log(f"Час вийшов — {cur['name']} не розрахувався", "turn", cur["id"])
                            self._bankrupt(cur, cur["debt"].get("to"))
                            changed = True
                    elif idle > limit and not st["auction"]:
                        st["trade"] = None
                        key = (st["turn"], st["turns"])
                        if st.get("autoKey") != key:
                            st["autoKey"] = key
                            fine = min(100, max(0, int(cur["money"])))
                            if fine > 0:
                                cur["money"] -= fine
                                if st["options"].get("parkingPot"):
                                    st["pot"] = st.get("pot", 0) + fine
                            self._log(
                                f"Час вийшов — {cur['name']} грає автоматично"
                                + (f", штраф {fmt(fine)}" if fine else ""),
                                "turn", cur["id"])
                        auto = None
                        try:
                            auto = self._bot_choice(cur)
                        except Exception:
                            traceback.print_exc()
                        if auto:
                            try:
                                self._apply(cur["id"], auto)
                            except RulesError:
                                try:
                                    self._end_turn(cur)
                                except Exception:
                                    traceback.print_exc()
                        else:
                            try:
                                self._end_turn(cur)
                            except Exception:
                                traceback.print_exc()
                        changed = True

                for pl in st["players"]:
                    if not pl["bankrupt"] and self._check_missions(pl):
                        changed = True
            if changed:
                self._bump()

    def _bot_choice(self, p):
        from .bots import choose_action
        return choose_action(self.state, p)

    # ---------- missions ----------

    def _mission_done(self, p, mid):
        st = self.state
        mine = [i for i, t in enumerate(st["tiles"]) if t["owner"] == p["id"]]
        if mid == "stations":
            return sum(1 for i in mine if self.board[i]["type"] == "rr") >= 3
        if mid == "monopoly":
            for g, tiles in GROUP_TILES.items():
                if len(tiles) < 2:
                    continue
                if any(self.board[i]["type"] != "street" for i in tiles):
                    continue
                if all(st["tiles"][i]["owner"] == p["id"] for i in tiles):
                    return True
            return False
        if mid == "hotel":
            return any(st["tiles"][i]["houses"] == 5 for i in mine)
        if mid == "cash":
            start = st["options"].get("startMoney") or START_MONEY
            return p["money"] >= start * 2.5
        if mid == "trades":
            return p.get("trades", 0) >= 2
        if mid == "casino":
            return p.get("casinoWins", 0) >= 1
        return False

    def _check_missions(self, p):
        changed = False
        for m in p.get("missions") or []:
            if m.get("done"):
                continue
            if not self._mission_done(p, m["id"]):
                continue
            info = MISSION_BY_ID.get(m["id"])
            if not info:
                continue
            m["done"] = True
            p["money"] += info["reward"]
            self._log(f"{p['name']} виконав секретну місію (+{fmt(info['reward'])})", "mission", p["id"])
            changed = True
        return changed

    # ---------- snapshot ----------

    def snapshot(self, pid=None):
        with self.lock:
            st = self.state
            players = []
            now = time.time()
            for p in st["players"]:
                q = {k: v for k, v in p.items() if k not in ("token", "lastSeen")}
                q["afk"] = (not p["bot"]) and (now - p["lastSeen"] > 45)
                if p["id"] == pid or st["phase"] == "ended":
                    q["missions"] = [
                        {"id": m["id"], "done": bool(m.get("done")),
                         "text": MISSION_BY_ID.get(m["id"], {}).get("text", ""),
                         "reward": MISSION_BY_ID.get(m["id"], {}).get("reward", 0)}
                        for m in (p.get("missions") or [])
                    ]
                else:
                    q["missions"] = []
                players.append(q)
            data = {
                "code": st["code"],
                "phase": st["phase"],
                "options": st["options"],
                "players": players,
                "host": st["host"],
                "turn": st["turn"],
                "dice": st["dice"],
                "doubles": st["doubles"],
                "awaiting": st["awaiting"],
                "tiles": st["tiles"],
                "housesLeft": st["housesLeft"],
                "hotelsLeft": st["hotelsLeft"],
                "log": st["log"][-160:],
                "chat": st["chat"][-120:],
                "version": st["version"],
                "auction": st["auction"],
                "trade": st["trade"],
                "lastCard": st["lastCard"],
                "winner": st["winner"],
                "pot": st.get("pot", 0),
                "round": st.get("round", 1),
                "rentBoost": st.get("rentBoost", 1.0),
                "updated": st["updated"],
                "startedAt": st["startedAt"],
            }
            limit = int(st["options"].get("turnTimer") or 0)
            left = 0
            if limit > 0 and st["phase"] == "playing" and st["turn"]:
                act_t = st.get("turnActivity") or now
                left = max(0, int(round(limit - (now - act_t))))
            data["turnLeft"] = left
            tleft = MAX_TRADES_TURN
            if st.get("tradeKey") == st.get("turn") and st.get("turn"):
                tleft = max(0, MAX_TRADES_TURN - int(st.get("tradeCount") or 0))
            data["tradeLeft"] = tleft
            data["you"] = pid
            return data
