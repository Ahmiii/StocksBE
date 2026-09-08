export const pause = (minMs, maxMs) =>
  new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));

export const pauseBetweenCalls = () => pause(1000, 3000);
export const providerSaysStop = (error) => {
  const status = error.response?.status;
  return status === 429 || status >= 500;
};
