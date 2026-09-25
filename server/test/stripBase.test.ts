import { describe, expect, it } from 'vitest';
import { stripBase } from '../src/app';
import { safeOriginalName } from '../src/upload/tus';

describe('stripBase', () => {
  it('strips a leading /photos', () => {
    expect(stripBase('/photos/api/health')).toBe('/api/health');
  });
  it('bare /photos → /', () => {
    expect(stripBase('/photos')).toBe('/');
  });
  it('/photos?x=1 → /?x=1', () => {
    expect(stripBase('/photos?x=1')).toBe('/?x=1');
  });
  it('leaves non-prefixed urls alone', () => {
    expect(stripBase('/api/health')).toBe('/api/health');
    expect(stripBase('/')).toBe('/');
  });
  it('does not strip a look-alike path', () => {
    expect(stripBase('/photosxyz/api/health')).toBe('/photosxyz/api/health');
  });
  it('keeps the trailing slash on the uploads endpoint', () => {
    expect(stripBase('/photos/api/uploads/')).toBe('/api/uploads/');
  });
});

describe('safeOriginalName', () => {
  it('keeps normal ascii names', () => {
    expect(safeOriginalName('IMG_5120.HEIC')).toBe('IMG_5120.HEIC');
  });
  it('replaces disallowed characters', () => {
    expect(safeOriginalName('my photo/../../etc.jpg')).toBe('etc.jpg');
  });
  it('takes only the basename (strips any path)', () => {
    expect(safeOriginalName('/a/b/c/photo.jpg')).toBe('photo.jpg');
  });
  it('truncates to 120 chars', () => {
    const long = `${'a'.repeat(200)}.jpg`;
    expect(safeOriginalName(long).length).toBeLessThanOrEqual(120);
  });
  it('keeps unicode letters (NFC-normalised)', () => {
    expect(safeOriginalName('café.jpg')).toBe('café.jpg');
  });
});
