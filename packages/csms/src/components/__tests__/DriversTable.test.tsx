// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/timezone', () => ({ formatDate: (value: string) => value }));

import { DriversTable, type Driver } from '../DriversTable';

const driver: Driver = {
  id: 'drv_1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: null,
  phone: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  fleets: [
    { id: 'flt_a', name: 'Leitung' },
    { id: 'flt_b', name: 'RHIEM Services' },
  ],
};

function renderTable(showFleets: boolean): void {
  render(
    <MemoryRouter initialEntries={['/drivers']}>
      <Routes>
        <Route
          path="/drivers"
          element={
            <DriversTable
              drivers={[driver, { ...driver, id: 'drv_2', fleets: [] }]}
              page={1}
              totalPages={1}
              onPageChange={() => undefined}
              timezone="UTC"
              showFleets={showFleets}
            />
          }
        />
        <Route path="/fleets/:id" element={<p>fleet page</p>} />
        <Route path="/drivers/:id" element={<p>driver page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('DriversTable fleets column', () => {
  it("shows each driver's fleets and opens a fleet on click", () => {
    renderTable(true);
    expect(screen.getByText('drivers.fleets')).toBeTruthy();
    expect(screen.getByText('Leitung')).toBeTruthy();
    expect(screen.getByText('RHIEM Services')).toBeTruthy();
    expect(screen.getByTestId('driver-row-drv_2').textContent).toContain('-');
    fireEvent.click(screen.getByText('Leitung'));
    expect(screen.getByText('fleet page')).toBeTruthy();
  });

  it('leaves the column out unless asked for', () => {
    renderTable(false);
    expect(screen.queryByText('drivers.fleets')).toBeNull();
    expect(screen.queryByText('Leitung')).toBeNull();
  });
});
