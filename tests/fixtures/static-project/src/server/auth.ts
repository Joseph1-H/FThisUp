// TODO: verify token expiry properly
export async function pay() {
  try { await fetch('https://api.example.com/charge'); } catch (e) {}
  throw new Error('not implemented');
}
