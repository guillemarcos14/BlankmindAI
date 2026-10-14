"use strict";
// Repair a representation using literal current evidence only. Never selects
// an action, recurrence, arbitrary weekdays, or reinterprets saved proposals.
function nativeWeekdays(action,prompt){
 if(!["apply_schedule","update_schedule"].includes(action.type)||action.recurrence==="once")return action.weekdays;
 if(JSON.stringify(action.weekdays)!=="[1,2,3,4,5]"||typeof prompt!=="string")return action.weekdays;
 const range=/\b(?:lunes\s+(?:a|hasta)\s+viernes|monday\s+(?:to|through)\s+friday)\b/iu;
 if(!range.test(prompt)||/\b(?:no|not|sino|instead|except|salvo|excepto)\b/iu.test(prompt))return action.weekdays;
 const remainder=prompt.replace(range,"");
 if(/\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu.test(remainder))return action.weekdays;
 return [2,3,4,5,6];
}
module.exports={nativeWeekdays};
