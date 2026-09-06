-- Canonical Tutorial Studio channel network used by the Drive/CDP uploader.
-- Exact UC ids are required: handles can change and the uploader deliberately
-- refuses to route a job using a handle or guessed identity.

UPDATE channels SET youtube_channel_id = 'UC7rwqoNmW4EthwQegKTlwfQ'
WHERE name = 'USA Tutorials' AND language = 'en';
UPDATE channels SET youtube_channel_id = 'UC1fIdn05S-h0Tucxx0sYu6A'
WHERE name = 'German Tutorials' AND language = 'de';
UPDATE channels SET youtube_channel_id = 'UCZk5FtCyvpDJqcQcBcW4DhQ'
WHERE name = 'French Tutorials' AND language = 'fr';
UPDATE channels SET youtube_channel_id = 'UC9VCQ_-_FCpaPWxheVYaCRA'
WHERE name = 'Italian Tutorials' AND language = 'it';
UPDATE channels SET youtube_channel_id = 'UCfvr1L5jwTRiMDHQmiDlw2Q'
WHERE name = 'Dutch Tutorials' AND language = 'nl';
UPDATE channels SET youtube_channel_id = 'UCC_uB1sgwY0r3qQRLd47nCw'
WHERE name = 'Swedish Tutorials' AND language = 'sv';

UPDATE channels
SET accepts_tutorials = true,
    is_primary = (language = 'en')
WHERE name IN (
  'USA Tutorials', 'German Tutorials', 'French Tutorials',
  'Italian Tutorials', 'Dutch Tutorials', 'Swedish Tutorials'
);
