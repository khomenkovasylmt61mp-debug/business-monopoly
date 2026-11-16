# Business Monopoly / Бізнес-Монополія

Browser board game for a company of up to 12 players. Classic Monopoly rules with
player-count scaling, Ukrainian UI, brand board (Silpo, Rozetka, monobank, Nova Poshta,
Glovo, Apple, Tesla...) and a classic board.

- Python 3.12 standard library only, no external dependencies.
- Rooms are kept in memory: a restart or sleep of the host resets games.
- Health endpoint: `/api/health`.
- Hosted on Render (free plan): the service sleeps after 15 minutes without traffic and
  wakes on the next request (~30-60 s).

Local run:

```
python server.py --port 8000
```

Docker:

```
docker build -t business-monopoly .
docker run -p 8000:8000 business-monopoly
```

Private game-night project.
