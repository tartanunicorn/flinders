-- The two walkthrough tables for a new product. Rename them freely and pass the names to
-- createWalkthroughRepository. Add row-level security to suit the product's tenants.
-- A server in another language (.NET, Go, ...) runs this file as it is: the triggers draw numbers
-- under a lock and refuse edits, so its code needs neither. See docs/own-backend.md.
--
-- walkthroughs: one row per version, never edited or deleted. Every change saves the next version,
-- so history, drafts beside a live version and Restore all work. owner_id null = the product's own;
-- set = one customer's. definition = { slug, title, status, permission, offer_on, reoffer_from, article, steps }.

CREATE TABLE walkthroughs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  walkthrough_id  uuid NOT NULL REFERENCES walkthroughs(id),
  owner_id        text,
  number          integer NOT NULL CHECK (number >= 1),
  version         integer NOT NULL CHECK (version >= 1),
  definition      jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object' AND definition->>'status' IN ('draft', 'live', 'inactive')),
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (walkthrough_id, version)
);

-- A number belongs to one walkthrough per owner, across its versions. NULLS NOT DISTINCT (Postgres 15+)
-- makes the product's own one owner, without any text value standing in for it.
CREATE UNIQUE INDEX walkthroughs_number_key ON walkthroughs (owner_id, number) NULLS NOT DISTINCT WHERE id = walkthrough_id;

-- A new walkthrough is its own original and draws the owner's next number; a later version copies it.
CREATE FUNCTION walkthroughs_set_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original_number integer;
BEGIN
  IF NEW.walkthrough_id IS NOT NULL AND NEW.walkthrough_id <> NEW.id THEN
    SELECT w.number INTO original_number FROM walkthroughs w WHERE w.id = NEW.walkthrough_id;
    IF NEW.number IS NOT NULL AND NEW.number IS DISTINCT FROM original_number THEN
      RAISE EXCEPTION 'walkthrough % is number %, not %', NEW.walkthrough_id, original_number, NEW.number
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.number := original_number;
    RETURN NEW;
  END IF;
  NEW.walkthrough_id := NEW.id;
  IF NEW.number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('walkthroughs.number:' || coalesce(NEW.owner_id, ''), 0));
    SELECT coalesce(max(w.number), 0) + 1 INTO NEW.number
      FROM walkthroughs w
     WHERE w.owner_id IS NOT DISTINCT FROM NEW.owner_id AND w.id = w.walkthrough_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER walkthroughs_set_identity BEFORE INSERT ON walkthroughs
  FOR EACH ROW EXECUTE FUNCTION walkthroughs_set_identity();

CREATE FUNCTION walkthroughs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'walkthroughs is append-only: save the next version';
END;
$$;
CREATE TRIGGER walkthroughs_append_only BEFORE UPDATE OR DELETE ON walkthroughs
  FOR EACH ROW EXECUTE FUNCTION walkthroughs_append_only();

-- One row per person per walkthrough. user_id is text so it fits any product's people.
CREATE TABLE walkthroughs_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  walkthrough_id  uuid NOT NULL REFERENCES walkthroughs(id),
  seen_version    integer NOT NULL CHECK (seen_version >= 1),
  status          text NOT NULL CHECK (status IN ('started', 'paused', 'completed', 'dismissed')),
  last_step       integer NOT NULL DEFAULT 0 CHECK (last_step >= 0),
  furthest_step   integer NOT NULL DEFAULT 0 CHECK (furthest_step >= 0),
  actions_done    integer NOT NULL DEFAULT 0 CHECK (actions_done >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, walkthrough_id)
);
