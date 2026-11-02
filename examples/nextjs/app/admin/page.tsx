'use client';

import { useEffect, useState } from 'react';
import type { AdminWalkthrough } from 'flinders';

import { useFlinders } from '../flinders-client';

export default function Admin() {
  const flinders = useFlinders();
  const [rows, setRows] = useState<AdminWalkthrough[]>([]);
  useEffect(() => {
    void flinders?.api?.admin.list().then((list) => list.ok && setRows(list.data));
  }, [flinders]);
  return (
    <ul data-testid="admin-list">
      {rows.map((row) => (
        <li key={row.handle}>
          {row.title}: {row.mode}, version {row.live_version} live, {row.steps_count} steps{row.problems.length ? ', needs update' : ''}
        </li>
      ))}
    </ul>
  );
}
