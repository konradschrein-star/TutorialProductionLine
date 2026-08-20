-- 0067_user_default_tutorial_channel.sql
--
-- The channel a given assistant produces for, chosen by that assistant.
--
-- WHY THIS EXISTS
-- ---------------
-- A tutorial with no channel gets a Drive folder literally named `_no-channel`,
-- no thumbnail styling, no channel voice, and no record of which of three
-- brands it was made for. 96% of the table is in that state.
--
-- The Create form already demands a channel, so the browser path is covered.
-- The Keyword Tool's "Produce" path is not: its Content Forge client sends no
-- channel_id at all, so everything it produced would land in `_no-channel`.
--
-- The obvious fix — one server-wide default channel — was rejected by the
-- owner, and correctly: "that's something the VA should decide and they get
-- instructions from my friend who is actually running this whole thing." A
-- single global default would silently attribute one assistant's video to the
-- brand another assistant was told to work on.
--
-- So the default is PER ASSISTANT and set by them: whatever channel they last
-- chose in the Create form is remembered here, and a keyword-produced job is
-- attributed to the channel its producing assistant is working on. If they have
-- never chosen one, the job is REFUSED with a message telling them to pick a
-- channel once in the studio — never guessed.
--
-- ON DELETE SET NULL, not CASCADE: retiring a channel must not delete people.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this is applied to prod BY HAND and
-- committing it does not apply it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_tutorial_channel_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_default_tutorial_channel_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_default_tutorial_channel_id_fkey
      FOREIGN KEY (default_tutorial_channel_id)
      REFERENCES channels(id) ON DELETE SET NULL;
  END IF;
END $$;
