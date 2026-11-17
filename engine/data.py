# -*- coding: utf-8 -*-
"""Класичне поле Монополії: 40 клітинок, картки Шанс/Скарбниця.
Правила трохи масштабуються під кількість гравців (див. SCALES).
"""

GROUPS = {
    "brown":     {"name": "Коричневі",    "color": "#8B5A2B"},
    "lightblue": {"name": "Блакитні",     "color": "#8FD7F2"},
    "pink":      {"name": "Рожеві",       "color": "#D93A8C"},
    "orange":    {"name": "Помаранчеві",  "color": "#F29B38"},
    "red":       {"name": "Червоні",      "color": "#E23B3B"},
    "yellow":    {"name": "Жовті",        "color": "#F5D547"},
    "green":     {"name": "Зелені",       "color": "#2FA84F"},
    "blue":      {"name": "Сині",         "color": "#2C55C7"},
    "rr":        {"name": "Вокзали",      "color": "#555555"},
    "util":      {"name": "Компанії",     "color": "#7A7A7A"},
}

# type: street / rr / util / chance / chest / tax / jail / parking / gotojail / go
BOARD = [
    {"id": 0,  "type": "go",     "name": "СТАРТ",              "sub": "+200 за проходження"},
    {"id": 1,  "type": "street", "name": "Медитеранська",      "group": "brown",     "price": 60,  "house": 50,  "rent": [2, 10, 30, 90, 160, 250]},
    {"id": 2,  "type": "chest",  "name": "Скарбниця"},
    {"id": 3,  "type": "street", "name": "Балтійська",         "group": "brown",     "price": 60,  "house": 50,  "rent": [4, 20, 60, 180, 320, 450]},
    {"id": 4,  "type": "tax",    "name": "Прибутковий податок","short": "Податок", "amount": 200},
    {"id": 5,  "type": "rr",     "name": "Reading",            "group": "rr",        "price": 200, "rent": [25, 50, 100, 200]},
    {"id": 6,  "type": "street", "name": "Східна",             "group": "lightblue", "price": 100, "house": 50,  "rent": [6, 30, 90, 270, 400, 550]},
    {"id": 7,  "type": "chance", "name": "Шанс"},
    {"id": 8,  "type": "street", "name": "Вермонт",            "group": "lightblue", "price": 100, "house": 50,  "rent": [6, 30, 90, 270, 400, 550]},
    {"id": 9,  "type": "street", "name": "Коннектикут",        "group": "lightblue", "price": 120, "house": 50,  "rent": [8, 40, 100, 300, 450, 600]},
    {"id": 10, "type": "jail",   "name": "Тюрма",              "sub": "Просто відвідування"},
    {"id": 11, "type": "street", "name": "Сент-Чарльз",        "group": "pink",      "price": 140, "house": 100, "rent": [10, 50, 150, 450, 625, 750]},
    {"id": 12, "type": "util",   "name": "Електромережа",      "group": "util",      "price": 150},
    {"id": 13, "type": "street", "name": "Штатів",             "group": "pink",      "price": 140, "house": 100, "rent": [10, 50, 150, 450, 625, 750]},
    {"id": 14, "type": "street", "name": "Вірджинія",          "group": "pink",      "price": 160, "house": 100, "rent": [12, 60, 180, 500, 700, 900]},
    {"id": 15, "type": "rr",     "name": "Pennsylvania",       "group": "rr",        "price": 200, "rent": [25, 50, 100, 200]},
    {"id": 16, "type": "street", "name": "Сент-Джеймс",        "group": "orange",    "price": 180, "house": 100, "rent": [14, 70, 200, 550, 750, 950]},
    {"id": 17, "type": "chest",  "name": "Скарбниця"},
    {"id": 18, "type": "street", "name": "Теннессі",           "group": "orange",    "price": 180, "house": 100, "rent": [14, 70, 200, 550, 750, 950]},
    {"id": 19, "type": "street", "name": "Нью-Йорк",           "group": "orange",    "price": 200, "house": 100, "rent": [16, 80, 220, 600, 800, 1000]},
    {"id": 20, "type": "parking","name": "Парковка"},
    {"id": 21, "type": "street", "name": "Кентуккі",           "group": "red",       "price": 220, "house": 150, "rent": [18, 90, 250, 700, 875, 1050]},
    {"id": 22, "type": "casino", "name": "Казино",            "sub": "червоне або чорне"},
    {"id": 23, "type": "street", "name": "Індіана",            "group": "red",       "price": 220, "house": 150, "rent": [18, 90, 250, 700, 875, 1050]},
    {"id": 24, "type": "street", "name": "Іллінойс",           "group": "red",       "price": 240, "house": 150, "rent": [20, 100, 300, 750, 925, 1100]},
    {"id": 25, "type": "rr",     "name": "B&O",                "group": "rr",        "price": 200, "rent": [25, 50, 100, 200]},
    {"id": 26, "type": "street", "name": "Атлантик",           "group": "yellow",    "price": 260, "house": 150, "rent": [22, 110, 330, 800, 975, 1150]},
    {"id": 27, "type": "street", "name": "Вентур",             "group": "yellow",    "price": 260, "house": 150, "rent": [22, 110, 330, 800, 975, 1150]},
    {"id": 28, "type": "util",   "name": "Водоканал",          "group": "util",      "price": 150},
    {"id": 29, "type": "street", "name": "Марвін Гарденс",     "group": "yellow",    "price": 280, "house": 150, "rent": [24, 120, 360, 850, 1025, 1200]},
    {"id": 30, "type": "gotojail","name": "До тюрми"},
    {"id": 31, "type": "street", "name": "Пасифік",            "group": "green",     "price": 300, "house": 200, "rent": [26, 130, 390, 900, 1100, 1275]},
    {"id": 32, "type": "street", "name": "Півн. Кароліна",     "group": "green",     "price": 300, "house": 200, "rent": [26, 130, 390, 900, 1100, 1275]},
    {"id": 33, "type": "chest",  "name": "Скарбниця"},
    {"id": 34, "type": "street", "name": "Пенсильванія",       "group": "green",     "price": 320, "house": 200, "rent": [28, 150, 450, 1000, 1200, 1400]},
    {"id": 35, "type": "rr",     "name": "Short Line",         "group": "rr",        "price": 200, "rent": [25, 50, 100, 200]},
    {"id": 36, "type": "chance", "name": "Шанс"},
    {"id": 37, "type": "street", "name": "Парк-Плейс",         "group": "blue",      "price": 350, "house": 200, "rent": [35, 175, 500, 1100, 1300, 1500]},
    {"id": 38, "type": "tax",    "name": "Податок на розкіш",  "short": "Розкіш", "amount": 100},
    {"id": 39, "type": "street", "name": "Бордвок",            "group": "blue",      "price": 400, "house": 200, "rent": [50, 200, 600, 1400, 1700, 2000]},
]

CHANCE = [    {"text": "Ідіть на СТАРТ. Отримайте 200 ₴.", "do": {"t": "move", "to": 0}},
    {"text": "Ідіть на Іллінойс. Якщо клітинка зайнята — сплатіть ренту.", "do": {"t": "move", "to": 24}},
    {"text": "Ідіть на Сент-Чарльз. Якщо клітинка зайнята — сплатіть ренту.", "do": {"t": "move", "to": 11}},
    {"text": "Ідіть до найближчої комунальної компанії. Якщо вона зайнята — киньте кубики й сплатіть у 10 разів більше.", "do": {"t": "nearest", "kind": "util"}},
    {"text": "Ідіть до найближчого вокзалу. Якщо він зайнятий — сплатіть подвійну ренту.", "do": {"t": "nearest", "kind": "rr"}},
    {"text": "Ідіть до найближчого вокзалу. Якщо він зайнятий — сплатіть подвійну ренту.", "do": {"t": "nearest", "kind": "rr"}},
    {"text": "Банк виплачує вам дивіденди: 50 ₴.", "do": {"t": "money", "amount": 50}},
    {"text": "Звільнення з тюрми. Збережіть картку.", "do": {"t": "getout"}},
    {"text": "Поверніться на 3 клітинки назад.", "do": {"t": "back", "n": 3}},
    {"text": "Ідіть до тюрми. Не проходьте СТАРТ, не отримуйте 200 ₴.", "do": {"t": "jail"}},
    {"text": "Ремонт: сплатіть 25 ₴ за кожен будинок і 100 ₴ за кожен готель.", "do": {"t": "repairs", "house": 25, "hotel": 100}},
    {"text": "Штраф за перевищення швидкості: 15 ₴.", "do": {"t": "pay", "amount": 15}},
    {"text": "Поїздка на Залізницю Reading. Якщо вона зайнята — сплатіть подвійну ренту.", "do": {"t": "move", "to": 5, "double": True}},
    {"text": "Ідіть на Бордвок.", "do": {"t": "move", "to": 39}},
    {"text": "Вас обрали головою ради: сплатіть кожному гравцю 50 ₴.", "do": {"t": "pay_each", "amount": 50}},
    {"text": "Термін позики на будівництво минув. Отримайте 150 ₴.", "do": {"t": "money", "amount": 150}},
]

CHEST = [
    {"text": "Ідіть на СТАРТ. Отримайте 200 ₴.", "do": {"t": "move", "to": 0}},
    {"text": "Банківська помилка на вашу користь: отримайте 200 ₴.", "do": {"t": "money", "amount": 200}},
    {"text": "Гонорар лікарю: сплатіть 50 ₴.", "do": {"t": "pay", "amount": 50}},
    {"text": "Дохід від продажу акцій: отримайте 50 ₴.", "do": {"t": "money", "amount": 50}},
    {"text": "Звільнення з тюрми. Збережіть картку.", "do": {"t": "getout"}},
    {"text": "Ідіть до тюрми. Не проходьте СТАРТ, не отримуйте 200 ₴.", "do": {"t": "jail"}},
    {"text": "Відпускні: отримайте 100 ₴.", "do": {"t": "money", "amount": 100}},
    {"text": "Повернення прибуткового податку: отримайте 20 ₴.", "do": {"t": "money", "amount": 20}},
    {"text": "У вас день народження: отримайте по 10 ₴ від кожного гравця.", "do": {"t": "collect_each", "amount": 10}},
    {"text": "Страховка життя: отримайте 100 ₴.", "do": {"t": "money", "amount": 100}},
    {"text": "Лікарняні витрати: сплатіть 100 ₴.", "do": {"t": "pay", "amount": 100}},
    {"text": "Оплата навчання: сплатіть 50 ₴.", "do": {"t": "pay", "amount": 50}},
    {"text": "Отримайте 25 ₴ за консультацію.", "do": {"t": "money", "amount": 25}},
    {"text": "Ремонт вулиць: сплатіть 40 ₴ за кожен будинок і 115 ₴ за кожен готель.", "do": {"t": "repairs", "house": 40, "hotel": 115}},
    {"text": "Друге місце на конкурсі краси: отримайте 10 ₴.", "do": {"t": "money", "amount": 10}},
    {"text": "Ви отримали спадок: 100 ₴.", "do": {"t": "money", "amount": 100}},
]

PLAYER_COLORS = [
    {"key": "red",    "name": "Червоний",  "hex": "#EF4444"},
    {"key": "blue",   "name": "Синій",     "hex": "#3B82F6"},
    {"key": "green",  "name": "Зелений",   "hex": "#22C55E"},
    {"key": "amber",  "name": "Жовтий",    "hex": "#EAB308"},
    {"key": "violet", "name": "Фіолет.",   "hex": "#A855F7"},
    {"key": "pink",   "name": "Рожевий",   "hex": "#EC4899"},
    {"key": "cyan",   "name": "Бірюз.",    "hex": "#06B6D4"},
    {"key": "orange", "name": "Оранж.",    "hex": "#F97316"},
    {"key": "lime",   "name": "Лайм",      "hex": "#84CC16"},
    {"key": "indigo", "name": "Індиго",    "hex": "#6366F1"},
    {"key": "teal",   "name": "Темно-зел.","hex": "#14B8A6"},
    {"key": "brown",  "name": "Коричн.",   "hex": "#92400E"},
]

# фігурки як у справжній Монополії
PIECES = [
    {"icon": "🚗", "name": "Машинка", "img": "car.webp"},
    {"icon": "🚢", "name": "Кораблик", "img": "ship.webp"},
    {"icon": "🎩", "name": "Циліндр", "img": "hat.webp"},
    {"icon": "✈️", "name": "Літак", "img": "plane.webp"},
    {"icon": "🐕", "name": "Собака", "img": "dog.webp"},
    {"icon": "🐈", "name": "Кіт", "img": "cat.webp"},
    {"icon": "👑", "name": "Корона", "img": "crown.webp"},
    {"icon": "🚀", "name": "Ракета", "img": "rocket.webp"},
    {"icon": "🐴", "name": "Кінь", "img": "horse.webp"},
    {"icon": "💎", "name": "Бриліант", "img": "diamond.webp"},
    {"icon": "🤖", "name": "Робот", "img": "robot.webp"},
    {"icon": "⚓", "name": "Якір", "img": "anchor.webp"},
]

# ---------- масштабування правил під кількість гравців ----------
# Чим більше гравців — тим більше стартових грошей, більше будинків у банку
# і трохи вища рента, щоб партія не тягнулася на весь вечір.
SCALES = [
    {"max": 3,  "startMoney": 1200, "houses": 32, "hotels": 12, "rent": 1.5,  "label": "2-3 гравці"},
    {"max": 5,  "startMoney": 1500, "houses": 32, "hotels": 12, "rent": 1.5,  "label": "4-5 гравців"},
    {"max": 7,  "startMoney": 1800, "houses": 40, "hotels": 16, "rent": 1.725, "label": "6-7 гравців"},
    {"max": 9,  "startMoney": 2200, "houses": 48, "hotels": 20, "rent": 1.95, "label": "8-9 гравців"},
    {"max": 12, "startMoney": 2600, "houses": 60, "hotels": 26, "rent": 2.1,  "label": "10-12 гравців"},
]


def scale_for(n):
    for s in SCALES:
        if n <= s["max"]:
            return dict(s)
    return dict(SCALES[-1])


GROUP_TILES = {}
for _t in BOARD:
    if _t["type"] in ("street", "rr", "util"):
        GROUP_TILES.setdefault(_t["group"], []).append(_t["id"])

# ================= друге поле: українські бренди =================
BRAND_GROUPS = {
    "brown":     {"name": "Продукти",         "color": "#8B5A2B"},
    "lightblue": {"name": "Маркетплейси",     "color": "#8FD7F2"},
    "pink":      {"name": "Банки",            "color": "#D93A8C"},
    "orange":    {"name": "Мобільний звʼязок","color": "#F29B38"},
    "red":       {"name": "Фастфуд",          "color": "#E23B3B"},
    "yellow":    {"name": "Таксі й доставка", "color": "#F5D547"},
    "green":     {"name": "Техніка",          "color": "#2FA84F"},
    "blue":      {"name": "Преміум",          "color": "#2C55C7"},
    "rr":        {"name": "Логістика",        "color": "#555555"},
    "util":      {"name": "Комунальні",       "color": "#7A7A7A"},
}

BRAND_NAMES = {
    1: "Сільпо",
    3: "АТБ",
    5: "Укрзалізниця",
    6: "Rozetka",
    8: "Prom.ua",
    9: "OLX",
    11: "monobank",
    12: "ДТЕК",
    13: "ПриватБанк",
    14: "Ощадбанк",
    15: "Нова пошта",
    16: "Київстар",
    18: "Vodafone",
    19: "lifecell",
    21: "McDonaldʼs",
    23: "KFC",
    24: "Пузата Хата",
    25: "Укрпошта",
    26: "Bolt",
    27: "Uber",
    28: "Київводоканал",
    29: "Glovo",
    31: "Apple",
    32: "Samsung",
    34: "Comfy",
    35: "Meest",
    37: "Tesla",
    39: "ЦУМ",
}

BRAND_ICONS = {
    1: "🛒", 3: "🛍️",
    5: "🚆", 15: "📦", 25: "✉️", 35: "📮",
    6: "🛒", 8: "🏷️", 9: "🏷️",
    11: "💳", 13: "💳", 14: "🏦",
    16: "📶", 18: "📱", 19: "📡",
    21: "🍔", 23: "🍗", 24: "🥟",
    26: "🚕", 27: "🚗", 29: "🛵",
    12: "⚡", 28: "💧",
    31: "🍏", 32: "📱", 34: "🖥️",
    37: "🚘", 39: "🏬",
}

# фірмові кольори для шапок карток власності
BRAND_COLORS = {
    1: "#F36F21", 3: "#D71920", 5: "#1F6B43", 6: "#2FA84F",
    8: "#8B3FA8", 9: "#00A3A3", 11: "#151515", 12: "#0057B8",
    13: "#2E8B57", 14: "#0B6E4F", 15: "#D71920", 16: "#0057B8",
    18: "#E60000", 19: "#E30613", 21: "#DA291C", 23: "#C8102E",
    24: "#A0522D", 25: "#FFD200", 26: "#34D186", 27: "#151515",
    28: "#1E5AA8", 29: "#FFC244", 31: "#555555", 32: "#1428A0",
    34: "#E30613", 35: "#C8102E", 37: "#CC0000", 39: "#C9A227",
}

BOARD_BRANDS = []
for _t in BOARD:
    _n = dict(_t)
    if _t["id"] in BRAND_NAMES:
        _n["name"] = BRAND_NAMES[_t["id"]]
        _n["logo"] = f"{_t['id']}.png"
    if _t["id"] in BRAND_COLORS:
        _n["brandColor"] = BRAND_COLORS[_t["id"]]
    if _t["id"] in BRAND_ICONS:
        _n["icon"] = BRAND_ICONS[_t["id"]]
    BOARD_BRANDS.append(_n)

THEMES = {
    "brands": {"name": "Бренди", "board": BOARD_BRANDS, "groups": BRAND_GROUPS},
    "classic": {"name": "Класика", "board": BOARD, "groups": GROUPS},
}

# назви для текстів карток у брендовій темі
BRAND_CARD_WORDS = {
    "Іллінойс": "Пузату Хату",
    "Сент-Чарльз": "monobank",
    "Бордвок": "ЦУМ",
    "Залізницю Reading": "Укрзалізницю",
}

# Секретні місії: по 2 на гравця, бонус видається одразу після виконання.
MISSIONS = [
    {"id": "stations", "text": "Зібрати 3 вокзали", "reward": 300},
    {"id": "monopoly", "text": "Зібрати повну групу вулиць", "reward": 400},
    {"id": "hotel", "text": "Побудувати готель", "reward": 400},
    {"id": "cash", "text": "Нагромадити 2,5× стартового капіталу", "reward": 500},
    {"id": "trades", "text": "Провести 2 обміни", "reward": 300},
    {"id": "casino", "text": "Виграти в казино", "reward": 300},
]
MISSION_BY_ID = {m["id"]: m for m in MISSIONS}

# Європейська рулетка: червоні числа
ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
 
