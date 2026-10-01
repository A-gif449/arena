import crypto from "crypto";
import { db, verifyBearer, getUserRole, json } from "./_lib/arena.js";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
const DURATIONS={1:"1_month",3:"3_months",6:"6_months",12:"1_year"};
function hashCode(code){return crypto.createHash("sha256").update(String(code||"").trim().toUpperCase()).digest("hex");}
export default async function handler(req,res){
  if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
  try{
    const decoded=await verifyBearer(req); const role=await getUserRole(decoded.uid);
    if(role==="admin"||role==="owner")return json(res,200,{active:true,plan:"admin_lifetime",expiresAt:null,source:"admin"});
    const raw=String(req.body?.code||"").trim().toUpperCase();
    if(!/^ARENA-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(raw))return json(res,400,{error:"Enter a valid Arena Pro access code."});
    const firestore=db(); const ref=firestore.collection("proAccessCodes").doc(hashCode(raw)); const subRef=firestore.collection("subscriptions").doc(decoded.uid);
    const result=await firestore.runTransaction(async tx=>{
      const codeSnap=await tx.get(ref); if(!codeSnap.exists){const e=new Error("That access code is invalid.");e.statusCode=400;throw e;}
      const code=codeSnap.data(); if(code.status!=="active"||code.redeemedBy){const e=new Error("That access code has already been used or is no longer active.");e.statusCode=400;throw e;}
      const subSnap=await tx.get(subRef); const sub=subSnap.exists?subSnap.data():{}; const now=new Date(); const old=sub.expiresAt?.toDate?.(); const start=sub.status==="active"&&old&&old>now?old:now;
      const expires=new Date(start); expires.setMonth(expires.getMonth()+Number(code.durationMonths));
      tx.set(subRef,{uid:decoded.uid,plan:`pro_code_${code.durationMonths}m`,status:"active",startsAt:Timestamp.fromDate(start),expiresAt:Timestamp.fromDate(expires),provider:"admin_code",accessCodeId:ref.id,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      tx.update(ref,{status:"redeemed",redeemedBy:decoded.uid,redeemedByEmail:decoded.email||"",redeemedAt:FieldValue.serverTimestamp()});
      return {expiresAt:expires.toISOString(),durationMonths:Number(code.durationMonths)};
    });
    return json(res,200,{active:true,plan:`pro_code_${result.durationMonths}m`,expiresAt:result.expiresAt,source:"admin_code"});
  }catch(err){console.error("redeem-pro-code error",err);return json(res,err.statusCode||500,{error:err.message||"Could not redeem access code."});}
}
//redeem-pro-code.js