/** A no-change repair is proved by its failed second attempt, not a budget message alone. */
export function failedNoChangeRepair(reason, attempts) {
  return /automatic repair writer failed: writer settled without changing any file/.test(reason)
    && Array.isArray(attempts) && attempts.length === 2
    && attempts[0].number === 1 && attempts[0].state === "completed"
    && attempts[1].number === 2 && attempts[1].state === "failed";
}
