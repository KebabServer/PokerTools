// The sandboxed solver can request only its own library and browser saves.
const pokerToolsHost = (() => {
  const scope = 'poker-tools-turn-river-lab';
  const hostOrigin = new URL(document.baseURI).origin;
  const send = (action, value, transfer = []) => {
    window.parent.postMessage({ scope, action, value }, hostOrigin, transfer);
  };

  new ResizeObserver(() => {
    send('resize', Math.ceil(document.body.getBoundingClientRect().height));
  }).observe(document.body);

  return {
    scrollToTop: () => send('scroll-top'),
    request(action, value) {
      return new Promise((resolve, reject) => {
        const { port1, port2 } = new MessageChannel();
        const timeout = setTimeout(() => {
          port1.close();
          reject(new Error('PokerTools did not respond. Please try again.'));
        }, 45000);
        port1.onmessage = ({ data }) => {
          clearTimeout(timeout);
          port1.close();
          if (data.ok) resolve(data.value);
          else reject(new Error(data.error));
        };
        send(action, value, [port2]);
      });
    },
  };
})();
