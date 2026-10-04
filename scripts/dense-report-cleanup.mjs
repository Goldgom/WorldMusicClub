/** Keep primary playback evidence before awaiting a process or browser close.
 * An intermediate file is explicitly unaccepted; every cleanup is attempted. */
export async function finishDenseReport(report,{resources,persist,validate}){
  const playbackOk=report.ok;
  report.ok=false;
  report.cleanup={status:'pending',resources:[],errors:[],writeErrors:[]};
  const save=async()=>{try{await persist(report);}catch(error){report.cleanup.writeErrors.push(String(error?.message||error).slice(0,512));}};
  await save();
  for(const resource of resources){
    const row={name:resource.name,status:resource.present?'pending':'not-created'};
    report.cleanup.resources.push(row);
    if(resource.present)try{await resource.close();row.status='closed';}catch(error){row.status='failed';row.error=String(error?.message||error).slice(0,512);report.cleanup.errors.push({name:row.name,error:row.error});}
    await save();
  }
  report.cleanup.status=report.cleanup.errors.length||report.cleanup.writeErrors.length?'failed':'complete';
  report.ok=playbackOk&&report.cleanup.status==='complete';
  if(report.ok)try{validate(report);}catch(error){report.ok=false;report.error=String(error?.stack||error);}
  if(!report.ok&&!report.error)report.error=`Dense cleanup failed: ${JSON.stringify(report.cleanup)}`;
  await save();
  if(report.cleanup.writeErrors.length){report.ok=false;report.cleanup.status='failed';throw Error(`Dense evidence write failed: ${report.cleanup.writeErrors.join('; ')}`);}
  return report;
}
