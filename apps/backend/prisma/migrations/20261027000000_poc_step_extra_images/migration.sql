-- Several PoC images per testing step. The existing image_path stays the step's first PoC, so existing
-- rows need no data change; further PoCs are kept, in order, in extra_image_paths.
ALTER TABLE "poc_steps" ADD COLUMN "extra_image_paths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
