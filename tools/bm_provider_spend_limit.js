"use strict";
// An additional campaign ceiling can only tighten the shared authorization.
const fs=require('node:fs'),path=require('node:path');
function limit(budgetFile,budget,guardFile=process.env.BM_PROVIDER_SPEND_LIMIT_FILE){
 if(!Number.isFinite(budget.limit_usd)||budget.limit_usd<0)throw Error('shared_budget_invalid_limit');
 if(!guardFile)return budget.limit_usd;
 const g=JSON.parse(fs.readFileSync(guardFile));
 if(g.version!==1||path.resolve(g.budget_file)!==path.resolve(budgetFile)
  ||![g.initial_reserved_upper_usd,g.maximum_additional_usd,g.authorized_cumulative_limit_usd].every(n=>Number.isFinite(n)&&n>=0)
  ||g.maximum_additional_usd<=0||g.initial_reserved_upper_usd>budget.reserved_upper_usd+1e-9)throw Error('shared_budget_invalid_campaign_guard');
 return Math.min(budget.limit_usd,g.authorized_cumulative_limit_usd,g.initial_reserved_upper_usd+g.maximum_additional_usd);
}
module.exports={limit};
