// A well-behaved "desktop app": stays alive and shuts down cleanly on SIGTERM.
console.log('window opened');
const t = setInterval(() => {}, 1000);
process.on('SIGTERM', () => { clearInterval(t); console.log('closing'); process.exit(0); });
