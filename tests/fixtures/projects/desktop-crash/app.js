// INTENTIONALLY BROKEN "desktop app": crashes during startup.
console.log('starting up...');
setTimeout(() => { const settings = undefined; console.log(settings.theme); }, 500);   // BUG: uncaught TypeError after launch
setInterval(() => {}, 1000);
