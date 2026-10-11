function createPool(limit) {
  let active = 0;
  const queue = [];
  function pump() {
    while (active < limit && queue.length) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active -= 1; pump(); });
    }
  }
  return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
}
module.exports = { createPool };
