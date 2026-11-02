export default async function Project({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h2>Project {id}</h2>
      <p>
        <label>Notes <input data-testid="project-notes" /></label>
      </p>
      <button data-testid="save">Save</button>
    </>
  );
}
