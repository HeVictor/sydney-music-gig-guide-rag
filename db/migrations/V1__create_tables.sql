-- Schema for storing Gig objects
--
-- Changes from v1:
--   * date + time are combined into a single `gig_datetime` DATETIME column,
--     so you can query "gigs after/before X" with plain comparisons.
--     `dayOfWeek` is no longer stored — it's derivable from gig_datetime
--     with DAYNAME(gig_datetime), so there's no risk of it drifting out of
--     sync with the actual date.
--   * supportingActs/lineup are normalized into a `gig_acts` table instead
--     of JSON columns, so "every gig with band X" is a plain indexed join
--     instead of a JSON scan.
--   * `id` (from the source site) is the sole identity key for a gig — it's
--     never null and there is no composite fallback key. A re-scrape with
--     the same id is always treated as an update to that exact gig, even if
--     its datetime, venue, event_title, or full lineup have all changed.

CREATE TABLE IF NOT EXISTS gigs (
  id            CHAR(36)      NOT NULL PRIMARY KEY, -- always populated from the scraped source, never generated
  gig_datetime  DATETIME      NOT NULL,              -- combined date + time, e.g. 2026-08-14 18:00:00
  venue         VARCHAR(255)  NOT NULL,
  venue_url     VARCHAR(1024) NULL,
  main_act      VARCHAR(255)  NULL,                  -- denormalized copy of the headliner for convenience; source of truth is gig_acts
  event_title   VARCHAR(255)  NULL,
  more_info_url VARCHAR(1024) NULL,
  is_free       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- id (from the source site) is the sole identity key for a gig — no
  -- composite fallback. gig_datetime/venue are indexed for querying, not
  -- for de-duplication.
  INDEX idx_gig_datetime (gig_datetime),
  INDEX idx_venue (venue)
);

CREATE TABLE IF NOT EXISTS gig_acts (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  gig_id    CHAR(36)     NOT NULL,
  act_name  VARCHAR(255) NOT NULL,
  role      ENUM('main', 'support') NOT NULL,  -- 'main' only when the gig has a single headliner (mainAct set, eventTitle null)
  position  SMALLINT UNSIGNED NOT NULL,        -- preserves original lineup order

  FOREIGN KEY (gig_id) REFERENCES gigs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_gig_act (gig_id, act_name),     -- prevents dupes when re-inserting on a re-scrape
  INDEX idx_act_name (act_name)
);

-- Example queries this schema is built for:
--
-- Gigs after a given moment:
--   SELECT * FROM gigs WHERE gig_datetime > '2026-08-01 00:00:00' ORDER BY gig_datetime;
--
-- Every gig featuring "Georgia Mulligan":
--   SELECT g.*
--   FROM gigs g
--   JOIN gig_acts ga ON ga.gig_id = g.id
--   WHERE ga.act_name = 'Georgia Mulligan'
--   ORDER BY g.gig_datetime;