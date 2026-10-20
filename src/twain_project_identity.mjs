/* Read-only live identity gate for Twain project selection.
 * Never substitute active_set.txt or pad position for an aligned live answer. */
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validModel(v) {
    return Array.isArray(v) && v.length>=3 && v[0]===1 &&
        Number.isSafeInteger(v[1]) && Number.isSafeInteger(v[2]) && v[1]>0 && v[1]===v[2];
}
export function probeProjectIdentity({readModel,readActive}={}) {
    readModel ??= ()=>globalThis.host_move_model_state?.();
    readActive ??= ()=>globalThis.shadow_get_param?.(0,'active_set');
    try {
        const before=readModel();
        if(!validModel(before))return {ready:false,reason:'project transition or live model unavailable'};
        const raw=readActive();
        const after=readModel();
        if(!validModel(after) || before[1]!==after[1])return {ready:false,reason:'project changed during read'};
        if(typeof raw!=='string')return {ready:false,reason:'project query unavailable'};
        const [id,name,generation]=raw.split('\n');
        if(!UUID.test(id || ''))return {ready:false,reason:'project has no persistent ID yet'};
        if(!generation || !/^\d+$/.test(generation) || Number(generation)!==after[1])
            return {ready:false,reason:'project identity is stale or unversioned'};
        return {ready:true,id:id.toLowerCase(),name:name || '',generation:after[1]};
    } catch (_) { return {ready:false,reason:'project query failed'}; }
}
