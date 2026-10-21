# AIsaac — Philosophy daily practice (Stoicism, existentialism)

Status: in progress
Scope: `repos/aisaac_dashboard` (`isaacsilver13/aisaac`). Branch from `origin/master`. Depends on
[daily pushes](2026-10-21-daily-pushes.md).

## Goal

Each day: a morning passage from a Stoic or existentialist with an intention prompt, and an evening reflection
question. Both are answered and journaled in an AIsaac `/philosophy` page; both pushes are toggleable.

## Constraints and non-goals

- No LLM. Deterministic daily rotation, like `backend/app/learning.py` (`today()`, `pick()` by Chicago date).
- Copyright: full passages only from public-domain translations — Marcus Aurelius (George Long), Epictetus
  (Elizabeth Carter / T. W. Higginson), Seneca (Richard Gummere), Kierkegaard (public-domain translations only),
  Nietzsche (Thomas Common), Dostoevsky (Constance Garnett). Sartre, Camus, de Beauvoir: **paraphrased ideas** in our
  own words with at most a very short attributed quote.
- Journal text is private personal data: it lives in `personal_store.py` (`PERSONAL_DB_PATH`), read token to read,
  write token to write — the existing fifth-exception rules in `CLAUDE.md`.
- Non-goals: curriculum/quizzes, Socratic chat (Isaac picked "daily practice" only).

## Approach

1. `backend/app/data/philosophy.json`: ~60 entries
   `{id, school: "stoic"|"existentialist", author, source, passage, theme, morning_prompt, evening_question}`,
   schools alternating. Include source citation (work + book/letter number + translator).
2. `backend/app/personal_philosophy.py`: load the JSON once; `entry_for(day)` reuses `learning.pick()` over entry ids.
3. `personal_store.py`: `CREATE TABLE IF NOT EXISTS philosophy_journal (local_date TEXT PRIMARY KEY, entry_id TEXT,
   intention TEXT, reflection TEXT, updated_at TEXT)` + `get_journal(date)`, `upsert_journal(...)`, `list_journal(limit)`.
4. `main.py` endpoints:
   - `GET /api/v1/personal/philosophy/today` (read): today's entry + journal row.
   - `PUT /api/v1/personal/philosophy/journal/{local_date}` (write): `{intention?, reflection?}`, length-capped.
   - `GET /api/v1/personal/philosophy/journal` (read): history, newest first.
5. Frontend: `frontend/src/pages/Philosophy.tsx` (passage card, intention input, reflection textarea, history via
   `components/primitives/Table`); route in `App.tsx`; nav entry; client calls in `api.ts`.
6. Push kinds in `daily_pushes.PUSHES`:
   - `philosophy_morning` @ 7 CT: `"{author}: {passage (trimmed)} — {morning_prompt}"`.
   - `philosophy_evening` @ 21 CT: `evening_question`.

## Verification

- Automated: same date → same entry; consecutive days alternate schools; every JSON entry has every field and a
  non-empty source; journal upsert keeps the other field; auth on all three endpoints; vitest for saving a
  reflection. `ruff check .`, `npm run lint`, `npm run test`.
- Manual: toggle both kinds on in Settings, fire `/internal/daily-pushes/send` with a mocked 7am and 9pm, check messages.

## Risks / decisions needed

- Curating 60 accurate passages is the real work; spot-check citations against the public-domain texts
  (e.g. Project Gutenberg) rather than writing from memory.
