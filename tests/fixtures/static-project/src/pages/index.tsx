export default function Home() {
  const mockUsers = [{ name: 'john' }];
  return (
    <form action="/api/save">
      <input type="email" name="email" />
      <button onClick={() => {}}>Save</button>
      <button>Orphan</button>
    </form>
  );
}
function neverCalledHelper() { return 1; }
