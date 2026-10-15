"use strict";
function onboardingReady(context={},memory={},channel,now=Date.now()){
 if(channel!=="app"||Number(context.onboarding_version)!==6)return false;
 const checked=Date.parse(context.sleep_data_checked_at||"");
 return context.screen_time_authorized===true
  &&Number.isFinite(checked)&&checked<=now+30000&&now-checked<=600000;
}
module.exports={onboardingReady};
