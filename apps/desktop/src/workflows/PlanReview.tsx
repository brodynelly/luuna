import { useState } from "react";
import type { PlanRevision } from "@luuna/api-client";
import { Box, Button, Checkbox, CodeBlock, Id, Meta } from "../ui";

/** A field's UTF-8 byte count under it, as the runtime counts it. */
export function ByteCount({ id, bytes, limit, prefix = "" }: { id: string; bytes: number; limit: number; prefix?: string }) {
  return <Meta className="byte-count" id={id}>{prefix}{bytes} of {limit} bytes{bytes > limit ? " · too long" : ""}</Meta>;
}

/** The complete immutable plan and its full hash; approval waits for the acknowledgment. */
export function PlanReview({ plan, canApprove, busy, onApprove }: { plan: PlanRevision; canApprove: boolean; busy: boolean; onApprove: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <Box className="plan-review">
    <Meta block>Immutable plan hash: <Id className="plan-hash">{plan.hash}</Id></Meta>
    <CodeBlock className="plan-document" label="Complete immutable plan" data-capability="plans.show">{JSON.stringify(plan, null, 2)}</CodeBlock>
    {canApprove && <>
      <Checkbox className="plan-acknowledgment" label="I reviewed this complete plan and hash." checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
      <Button variant="primary" disabled={busy || !reviewed} data-capability="plans.approve" onClick={() => { if (reviewed) onApprove(); }}>Approve r{plan.revision}</Button>
    </>}
  </Box>;
}
