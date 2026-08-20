import { z } from "zod";

export const TechFootageCollectionPayloadSchema = z.object({
  job_id: z.string().uuid(),
});

export type TechFootageCollectionPayload = z.infer<
  typeof TechFootageCollectionPayloadSchema
>;
