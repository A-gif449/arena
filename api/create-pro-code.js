import crypto from "crypto";
import { db, verifyBearer, requireAdmin, json } from "./_lib/arena.js";

const DURATIONS={1:"1_month",3:"3_months",6:"6_months",12:"1_year"};
function makeCode(){return `ARENA-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;}
function hashCode(code){return crypto.createHash("sha256").update(code).digest("hex");}
function cleanDuration(v){const n=Number(v);return DURATIONS[n]?n:null;}
export default async function handler(req,res){
  if(req.method!=="POST") return json(res,405,{error:"Method not allowed."});
  try{
    const decoded=await verifyBearer(req); await requireAdmin(decoded);
    const months=cleanDuration(req.body?.months); if(!months)return json(res,400,{error:"Choose 1, 3, 6 or 12 months."});
    const firestore=db(); let code="", hash="", ref=null;
    for(let i=0;i<5;i++){
      code=makeCode(); hash=hashCode(code); ref=firestore.collection("proAccessCodes").doc(hash);
      const snap=await ref.get(); if(!snap.exists)break;
    }
    await ref.create({codeHash:hash,durationMonths:months,durationLabel:DURATIONS[months],status:"active",createdBy:decoded.uid,createdByEmail:decoded.email||"",createdAt:new Date(),redeemedBy:null,redeemedAt:null});
    return json(res,200,{code,durationMonths:months,durationLabel:DURATIONS[months]});
  }catch(err){console.error("create-pro-code error",err);return json(res,err.statusCode||500,{error:err.message||"Could not create access code."});}
}
//create-pro-code.js