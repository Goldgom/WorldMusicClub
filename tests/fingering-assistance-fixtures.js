import {admitPracticeAssistance} from '../web/practice-assistance-receipt.js';
import {assistanceContext,assistanceBinding,assistanceResponse} from './practice-assistance-fixtures.js';

/** Synthetic admitted receipts exercise the fingering boundary after the app's
 * current-source check. No fixture is a native note-level fingering planner. */
export function fingeringAssistance({partial=false}={}){
  const context=assistanceContext({canonical:true}),options=partial?{}:{mode:'original',settings:null};
  return admitPracticeAssistance(assistanceResponse(context,options),assistanceBinding(context,options));
}
