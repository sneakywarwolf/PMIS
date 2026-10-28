import { parseSiteMapFile } from './site-map-import.util';

const f = (name: string, text: string) => ({ originalname: name, buffer: Buffer.from(text) }) as Express.Multer.File;

describe('parseSiteMapFile', () => {
  it('reads Directory Name / File Name in any column order and case, drops blanks and repeats', async () => {
    const r = await parseSiteMapFile(f('m.csv', 'file name,DIRECTORY NAME\nindex.js,/src\nindex.js,/src\n,\napp.js,\n,/lib\n'));
    expect(r.rows).toEqual([
      { directoryName: '/src', fileName: 'index.js' },
      { directoryName: '', fileName: 'app.js' },
      { directoryName: '/lib', fileName: '' },
    ]);
    expect(r.duplicates).toBe(1);
  });
  it('rejects a missing header, wrong type, empty and header-only files', async () => {
    await expect(parseSiteMapFile(f('m.csv', 'Directory,File\na,b'))).rejects.toThrow(/Directory Name, File Name/);
    await expect(parseSiteMapFile(f('m.txt', 'x'))).rejects.toThrow(/\.csv and \.xlsx/);
    await expect(parseSiteMapFile(undefined)).rejects.toThrow(/empty/);
    await expect(parseSiteMapFile(f('m.csv', 'Directory Name,File Name\n'))).rejects.toThrow(/No rows/);
  });
});
