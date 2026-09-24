export async function api<T= {ok:boolean}>(path:string,body?:unknown,method?:string,token?:string):Promise<T> {
  const response=await fetch(`/api${path}`,{method:method||(body===undefined?'GET':'POST'),credentials:'same-origin',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request could not be completed');return data as T;
}
