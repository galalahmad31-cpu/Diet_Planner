(() => {
  "use strict";
  const supabase = window.DietPlannerAccess?.supabaseClient;
  let channel = null, recipientId = null, root = null, busy = false;
  const icons = {nutrition_plan_published:"fa-bowl-food",appointment_requested:"fa-calendar-plus",appointment_confirmed:"fa-calendar-check",appointment_declined:"fa-calendar-xmark",appointment_cancelled:"fa-calendar-minus",message_received:"fa-comment-dots",followup_activated:"fa-circle-check",followup_ended:"fa-handshake-slash"};
  const destination = type => type === "nutrition_plan_published" ? "portalPlansPanel" : type?.startsWith("appointment_") ? "portalAppointmentsPanel" : "portalCommunicationPanel";
  const dateText = value => {const date=new Date(value);return value&&!Number.isNaN(date.getTime())?date.toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"}):"";};
  function render(items,unreadCount){
    if(!root)return;const list=root.querySelector("[data-patient-notification-list]"),count=root.querySelector("[data-patient-notification-count]"),empty=root.querySelector("[data-patient-notification-empty]"),all=root.querySelector("[data-patient-notification-read-all]");
    if(!list||!count||!empty||!all)return;count.textContent=Number(unreadCount||0).toLocaleString("ar-EG");count.hidden=!unreadCount;all.hidden=!unreadCount;empty.hidden=Boolean(items.length);list.replaceChildren();
    items.forEach(item=>{const card=document.createElement("article");card.className="patient-notification-item"+(item.read_at?"":" is-unread");
      const icon=document.createElement("span");icon.className="patient-notification-icon";const glyph=document.createElement("i");glyph.className="fa-solid "+(icons[item.event_type]||"fa-bell");icon.append(glyph);
      const content=document.createElement("div");content.className="patient-notification-content";const heading=document.createElement("div");heading.className="patient-notification-heading";
      const title=document.createElement("strong");title.textContent=item.title||"إشعار جديد";heading.append(title);
      if(!item.read_at){const fresh=document.createElement("span");fresh.className="patient-notification-new";fresh.textContent="جديد";heading.append(fresh);}
      const body=document.createElement("p");body.textContent=item.body||"";const time=document.createElement("time");time.dateTime=item.created_at||"";time.textContent=dateText(item.created_at);content.append(heading,body,time);
      const open=document.createElement("button");open.type="button";open.className="patient-notification-open";open.dataset.openPatientNotification=item.id;open.dataset.destination=destination(item.event_type);open.textContent="عرض التفاصيل";card.append(icon,content,open);list.append(card);
    });
  }
  async function load(){
    if(!recipientId||!root)return;const [events,unread]=await Promise.all([
      supabase.from("notifications").select("id,event_type,title,body,created_at,read_at").eq("recipient_id",recipientId).order("created_at",{ascending:false}).limit(30),
      supabase.from("notifications").select("id",{count:"exact",head:true}).eq("recipient_id",recipientId).is("read_at",null)
    ]);if(events.error)throw events.error;if(unread.error)throw unread.error;render(events.data||[],unread.count||0);
  }
  async function markAllRead(){
    if(busy)return;busy=true;const button=root?.querySelector("[data-patient-notification-read-all]");if(button)button.disabled=true;
    try{const {error}=await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("recipient_id",recipientId).is("read_at",null);if(error)throw error;await load();}
    catch(error){console.error("Patient notifications mark-all failed:",error);const status=root?.querySelector("[data-patient-notification-status]");if(status)status.textContent="تعذر تحديث الإشعارات. حاول مرة أخرى.";}
    finally{busy=false;if(button)button.disabled=false;}
  }
  function subscribe(){if(!recipientId||channel)return;channel=supabase.channel("dp-patient-notifications-"+recipientId).on("postgres_changes",{event:"INSERT",schema:"public",table:"notifications",filter:"recipient_id=eq."+recipientId},()=>load().catch(error=>console.error("Patient notifications refresh failed:",error))).subscribe();}
  async function init(container,userId){
    if(!container||!userId||!supabase)return;if(recipientId===userId&&root){await load();return;}if(channel){await supabase.removeChannel(channel);channel=null;}root=container;recipientId=userId;
    root.addEventListener("click",async event=>{const all=event.target.closest("[data-patient-notification-read-all]");if(all){await markAllRead();return;}const button=event.target.closest("[data-open-patient-notification]");if(!button||busy)return;busy=true;button.disabled=true;
      try{const {error}=await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("id",button.dataset.openPatientNotification).eq("recipient_id",recipientId).is("read_at",null);if(error)throw error;await load();await window.DietPlannerPatientPortal?.navigateToSection(button.dataset.destination);}
      catch(error){console.error("Patient notification open failed:",error);const status=root.querySelector("[data-patient-notification-status]");if(status)status.textContent="تعذر فتح الإشعار. حاول مرة أخرى.";}
      finally{busy=false;button.disabled=false;}
    });
    await load();subscribe();
  }
  window.DietPlannerPatientNotifications=Object.freeze({init});
})();