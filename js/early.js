/* Applies the saved theme and language before the first paint, so there is no flash.
   A separate file (not inline) so the server's Content-Security-Policy can forbid inline scripts. */
try {
  var th = localStorage.getItem('ledgerly:theme'), lg = localStorage.getItem('ledgerly:lang');
  if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th;
  if (lg === 'ar') { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl'; }
} catch (e) { /* storage unavailable */ }
