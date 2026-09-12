# Live room route contract

All Triviabranch Live games use direct room paths:

- `/host/:CODE` — host control surface
- `/play/:CODE` — player surface
- `/display/:CODE` — display surface
- `/admin` — catalogue/session administration

Room codes are uppercase, URL-safe identifiers. Pages must derive the room code from the path segment, not require a `?room=` or `?code=` query parameter.

The host, player and display surfaces connect to the same authoritative room/session over WebSocket. Catalogue, content and game configuration belong in D1; live room state belongs in the Durable Object/session layer.

New games must use this contract from their first build. Existing legacy query-string routes should be retained only as compatibility aliases while the surface is migrated.
