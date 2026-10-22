import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const installer = readFileSync('installer/Honsen-PDF-Translator.iss', 'utf8');
describe('desktop integration installer', () => {
  it('passes the identity and source to installed shortcuts', () => {
    const icons = installer.split('[Icons]')[1].split('[Tasks]')[0];
    expect(icons.match(/Parameters: "launch --app-id \{#HonsenAppId\} --source app"/g)).toHaveLength(2);
  });
  it('does not delete legacy shortcuts based only on their names', () => {
    const installDelete = installer.split('[InstallDelete]')[1].split('[UninstallDelete]')[0];
    expect(installDelete).not.toMatch(/\.lnk/i);
  });
});

it('never starts the Runner during silent installation', () => {
  const run = installer.split('[Run]')[1];
  expect(run).not.toMatch(/Check: IsSilentUpdate/);
  expect(run).toMatch(/Flags: nowait postinstall skipifsilent/);
});
