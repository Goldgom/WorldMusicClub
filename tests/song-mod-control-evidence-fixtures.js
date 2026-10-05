// Modeled verifier inputs only; these do not establish native or browser proof.
export function syntheticSongModControls({first='original-first',target='original-target',start=1,mute=false,solo=false}={}) {
  const rows=[
    {kind:'click',id:'configure-song-mod'},
    {kind:'select-last',field:'performer',part:first,value:'machine'},
    {kind:'select-first',field:'performer',part:target,value:'human'},
    ...(mute?[true,false].map(checked=>({kind:'click',field:'mute',part:first,checked})):[]),
    {kind:'click',id:'song-mod-apply'},
    {kind:'click',id:'start-performance'},
    {kind:'click',id:'edit-song-mod'},
    ...(solo?[true,false].map(checked=>({kind:'click',field:'mute',part:target,checked})):[]),
    {kind:'click',id:'song-mod-apply'},
  ];
  const modActions=rows.map((row,index)=>({sequence:start+index,id:null,field:null,part:null,value:null,checked:null,...row}));
  const trusted=modActions.map(row=>({actionSequence:row.sequence,type:row.field?'change':'click',id:row.id,part:row.part,modField:row.field,value:row.value,checked:row.checked,trusted:true}));
  return {modActions,trusted,actions:modActions.at(-1).sequence};
}
