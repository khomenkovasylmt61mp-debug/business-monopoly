# -*- coding: utf-8 -*-
"""Простой, но аккуратный бот: покупает, строит, платит, торгуется с банком."""
from .data import BOARD, GROUP_TILES


def _owned(state, pid):
    return [i for i, t in enumerate(state["tiles"]) if t["owner"] == pid]


def _can_build(state, pid, idx):
    tile = BOARD[idx]
    if tile["type"] != "street":
        return False
    st = state["tiles"][idx]
    if st["owner"] != pid or st["houses"] >= 5:
        return False
    group = GROUP_TILES[tile["group"]]
    if any(state["tiles"][g]["owner"] != pid or state["tiles"][g]["mortgaged"] for g in group):
        return False
    houses = [state["tiles"][g]["houses"] for g in group]
    return st["houses"] == min(houses)


def _pick_build(state, pid, reserve):
    best = None
    for i in _owned(state, pid):
        if not _can_build(state, pid, i):
            continue
        if BOARD[i]["price"] >= 300:
            score = 3
        elif BOARD[i]["price"] >= 220:
            score = 2
        else:
            score = 1
        if best is None or score > best[0]:
            best = (score, i)
    if best is None:
        return None
    return best[1]


def _raise_money(state, p):
    """Продаёт дом или закладывает имущество, чтобы закрыть долг."""
    pid = p["id"]
    debt = p["debt"]["amount"] if p["debt"] else 0
    if p["money"] >= debt:
        return None
    # 1) продать дома (сначала там, где их больше)
    best = None
    for i in _owned(state, pid):
        h = state["tiles"][i]["houses"]
        if h > 0:
            group = GROUP_TILES[BOARD[i]["group"]]
            hs = [state["tiles"][g]["houses"] for g in group]
            if h == max(hs):
                if best is None or h > state["tiles"][best]["houses"]:
                    best = i
    if best is not None:
        return {"type": "sell_house", "tile": best}
    # 2) заложить что-нибудь без домов в группе
    cand = []
    for i in _owned(state, pid):
        st = state["tiles"][i]
        if st["mortgaged"]:
            continue
        group = BOARD[i].get("group")
        if group and any(state["tiles"][g]["houses"] > 0 for g in GROUP_TILES[group]):
            continue
        cand.append(i)
    if cand:
        cand.sort(key=lambda i: BOARD[i]["price"])
        return {"type": "mortgage", "tile": cand[0]}
    return {"type": "bankrupt"}


def choose_action(state, p):
    pid = p["id"]
    aw = state.get("awaiting") or {}
    t = aw.get("type")

    if p.get("debt"):
        return _raise_money(state, p)

    if t == "auction":
        auc = state.get("auction")
        if not auc or auc["turn"] != pid:
            return None
        price = BOARD[auc["tile"]]["price"]
        bid = auc["bid"]
        nxt = bid + 10 if bid else 10
        if p["money"] >= nxt + 100 and bid < price * 0.75:
            return {"type": "bid", "amount": nxt}
        return {"type": "auction_pass"}

    if state.get("turn") != pid:
        return None

    if t == "roll":
        return {"type": "roll"}

    if t == "jail":
        if p["cards"] > 0:
            return {"type": "jail_card"}
        if p["money"] > 350:
            return {"type": "jail_pay"}
        return {"type": "roll"}

    if t == "buy":
        idx = aw["tile"]
        price = BOARD[idx]["price"]
        if p["money"] - price >= 60:
            return {"type": "buy"}
        return {"type": "decline_buy"}

    if t == "endturn":
        target = _pick_build(state, pid, 0)
        if target is not None:
            cost = BOARD[target]["house"]
            if p["money"] - cost >= 250:
                return {"type": "build", "tile": target}
        return {"type": "end_turn"}

    return None
