export interface Household { id:string; name:string; timezone:string; monthly_budget:number; invite_code:string; base_currency:string }
export interface Member { household_id:string; user_id:string; display_name:string; email:string|null; profile_user_id?:string|null; joined_at:string }
export interface Category { id:string; household_id:string; name:string; icon:string; color:string; archived:boolean; sort_order:number }


