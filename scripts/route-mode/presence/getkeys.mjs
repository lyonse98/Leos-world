import { loadKeys } from '/home/hatch/workspace/leos-world/repo-avatar/scripts/library/lib.mjs';
const k = await loadKeys();
console.log('keys loaded:', !!k.geminiKey, !!k.anonKey, k.supabaseUrl ? ('url=' + k.supabaseUrl) : 'no url');
