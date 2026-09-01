ALTER TABLE gigs
  ADD COLUMN event_title_signal_score INT NOT NULL DEFAULT 0
    AFTER event_title;