/**
 * version.js
 * Loads version.json and exposes a simple toString().
 * Edit version.json by hand to set the version for each release.
 */
export async function loadVersion(base = '') {
    const url = base + 'version.json';
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { major, minor, patch, label } = await res.json();
        return `v${major}.${minor}.${patch}${label ? '-' + label : ''}`;
    } catch (e) {
        console.warn('⚠️  loadVersion failed:', e.message);
        return null;
    }
}
