-- The ads-gifts feature was reworked from "10 ads/day = 1 daily ticket"
-- (a standalone section) into "watch ads to unlock + grow chances on an
-- ads-mode contest" (every 10 ads watched, all-time, = +1 chance, computed
-- live from gm_gift_ad_views). gm_gift_ad_tickets is no longer written to
-- or read anywhere, so it is dropped rather than left as dead schema.
DROP TABLE IF EXISTS public.gm_gift_ad_tickets;
