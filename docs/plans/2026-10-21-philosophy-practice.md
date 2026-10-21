# AIsaac — Philosophy daily practice (Stoicism, existentialism)

Status: complete (2026-10-21, branch claude/daily-pushes-philosophy-7c4092)
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

## Verification record (2026-10-21)

- Corpus: 60 entries (Marcus Aurelius 10, Epictetus 10, Seneca 10; Nietzsche 8, Dostoevsky 7, Kierkegaard 6,
  Sartre 3, Camus 3, de Beauvoir 3), alternating schools. Every quoted passage was extracted by script from the
  source text (start/end phrase, whitespace collapsed, footnote markers and `_italic_` underscores removed), not
  written from memory: Long, *Thoughts of Marcus Aurelius* (Gutenberg #15877; #2680 is Casaubon and was not used);
  Higginson, *Enchiridion* (Gutenberg #45109); Gummere, *Moral Letters* (Wikisource); Common, *Zarathustra*
  (Gutenberg #1998); Garnett, *Brothers Karamazov* (#28054) and *Notes from Underground* (#600); Hollander,
  *Selections from the Writings of Kierkegaard* (1923, #60333). The Common translation of *The Joyful Wisdom* on
  Gutenberg is mostly Cohn's, so it was not used. Book/section numbers were read from the source headings.
- Sartre, Camus, de Beauvoir: paraphrases in our own words, no quotations. Citations name the work and part;
  de Beauvoir's *Ethics of Ambiguity* freedom-of-others entry cites the work only (part not verified).
- `pytest` 220 passed, `ruff check .` clean; `npm run lint`, `npm run test` (151), `npm run build` OK.
- Manual: both kinds fired through `daily_pushes.run` at mocked 07:05 and 21:05 CT; messages were
  "Epictetus: This instant, then, … — Stop postponing one improvement…" and the evening question.
- Deviation: `entry_for` uses the same ordinal-mod rotation as `learning.pick()` rather than calling it, since
  `pick()` filters to vault folders.
