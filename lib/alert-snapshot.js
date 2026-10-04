const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

module.exports = async function writeAlertSnapshot(file, alerts) {
  // A sibling file keeps the rename on the same filesystem. Concurrent saves
  // have separate files, so readers only see a complete JSON snapshot.
  const temporaryFile = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(alerts), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryFile, file);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
};
