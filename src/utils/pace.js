// A pause of random length, so a run of requests is not evenly spaced.
export const pause = (minMs, maxMs) =>
  new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));

// Between two provider calls: one to three seconds, like someone clicking around.
export const pauseBetweenCalls = () => pause(1000, 3000);

// A provider answer that means "stop for today": rate limited or falling over.
export const providerSaysStop = (error) => {
  const status = error.response?.status;
  return status === 429 || status >= 500;
};
