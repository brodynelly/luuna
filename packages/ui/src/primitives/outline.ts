// DOM-free: the heading outline rule of the product (h2 per view, h3 per section, h4 inside a section). Title is the
// only emitter, so a test or a dev check can feed the orders in document order and read the problems.
export function outlineProblems(orders: number[]): string[] {
  const problems: string[] = [];
  const first = orders.filter((order) => order === 2).length;
  if (first > 1) problems.push(`one h2 per view, found ${first}`);
  let previous = 1;
  orders.forEach((order, index) => {
    if (order < 2 || order > 4) problems.push(`heading ${index + 1}: h${order} is outside h2 to h4`);
    else if (order > previous + 1) problems.push(`heading ${index + 1}: h${order} skips a level after h${previous}`);
    previous = order;
  });
  return problems;
}
