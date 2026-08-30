(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const brl = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const dateFmt = new Intl.DateTimeFormat('pt-BR');
  const today = new Date();
  const yyyyMm = (d=today) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const monthStart = m => `${m}-01`;
  const addMonths = (month, n) => { const [y,m]=month.split('-').map(Number); const d=new Date(y,m-1+n,1); return yyyyMm(d); };
  const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  const configOK = window.SUPABASE_URL && !window.SUPABASE_URL.includes('COLE_') && window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes('COLE_');
  if (!configOK) { $('#setupScreen').classList.remove('hidden'); return; }
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const state = { user:null, people:[], cards:[], categories:[], transactions:[] };
  const defaultCategories = ['Alimentação','Mercado','Moradia','Transporte','Combustível','Saúde','Farmácia','Lazer','Compras','Assinaturas','Cuidados pessoais','Outros'];
  const pageTitles = {dashboard:'Início',entry:'Novo lançamento',invoices:'Faturas da família',history:'Histórico',registers:'Cadastros'};

  function show(screen){ ['setupScreen','authScreen','mainScreen'].forEach(id=>$('#'+id).classList.add('hidden')); $('#'+screen).classList.remove('hidden'); }
  function setMessage(el,msg,err=false){ el.textContent=msg; el.style.color=err?'#b42318':'#067647'; }
  function nav(name){ $$('.view').forEach(v=>v.classList.remove('active')); $('#view-'+name).classList.add('active'); $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===name)); $('#pageTitle').textContent=pageTitles[name]; if(name==='dashboard') renderDashboard(); if(name==='invoices') renderInvoices(); if(name==='history') renderHistory(); if(name==='registers') renderRegisters(); }

  async function ensureSeed(){
    const uid=state.user.id;
    const [{data:p},{data:c},{data:cat}] = await Promise.all([
      sb.from('people').select('*').eq('user_id',uid).order('name'),
      sb.from('cards').select('*').eq('user_id',uid).order('name'),
      sb.from('categories').select('*').eq('user_id',uid).order('name')
    ]);
    if(!p?.length) await sb.from('people').insert([{user_id:uid,name:'Eu',is_self:true},{user_id:uid,name:'Alvaro'},{user_id:uid,name:'DD'},{user_id:uid,name:'Inaldo'},{user_id:uid,name:'Mainha'},{user_id:uid,name:'Papai'},{user_id:uid,name:'Tia izaide'},{user_id:uid,name:'Tiago'}]);
    if(!c?.length) await sb.from('cards').insert([{user_id:uid,name:'Banco Inter'},{user_id:uid,name:'Mercado Pago'}]);
    if(!cat?.length) await sb.from('categories').insert(defaultCategories.map(name=>({user_id:uid,name})));
  }

  async function loadData(){
    const uid=state.user.id;
    const [p,c,cat,t] = await Promise.all([
      sb.from('people').select('*').eq('user_id',uid).order('is_self',{ascending:false}).order('name'),
      sb.from('cards').select('*').eq('user_id',uid).order('name'),
      sb.from('categories').select('*').eq('user_id',uid).order('name'),
      sb.from('transactions').select('*,people(name),cards(name)').eq('user_id',uid).order('invoice_month',{ascending:false}).order('created_at',{ascending:false}).limit(3000)
    ]);
    if(p.error||c.error||cat.error||t.error) throw new Error((p.error||c.error||cat.error||t.error).message);
    state.people=p.data; state.cards=c.data; state.categories=cat.data; state.transactions=t.data;
    populateSelects(); renderDashboard();
  }

  function populateSelects(){
    $('#category').innerHTML=state.categories.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
    $('#card').innerHTML='<option value="">Sem cartão</option>'+state.cards.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
    $('#person').innerHTML=state.people.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
    $('#invoicePersonFilter').innerHTML='<option value="">Todas</option>'+state.people.filter(x=>!x.is_self).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
    const self=state.people.find(x=>x.is_self); if(self) $('#person').value=self.id;
  }

  function currentMonthTx(month){ return state.transactions.filter(t=>String(t.invoice_month||'').slice(0,7)===month); }
  function renderDashboard(){
    const month=$('#dashboardMonth').value||yyyyMm(); const tx=currentMonthTx(month);
    const income=tx.filter(t=>t.kind==='income').reduce((s,t)=>s+Number(t.installment_amount),0);
    const own=tx.filter(t=>t.kind==='expense'&&t.people?.name==='Eu').reduce((s,t)=>s+Number(t.installment_amount),0);
    const family=tx.filter(t=>t.kind==='expense'&&t.people?.name!=='Eu'&&t.reimbursement_status!=='paid').reduce((s,t)=>s+Number(t.installment_amount)-Number(t.amount_received||0),0);
    $('#kpiIncome').textContent=brl.format(income); $('#kpiOwnExpenses').textContent=brl.format(own); $('#kpiFamily').textContent=brl.format(family); $('#kpiBalance').textContent=brl.format(income-own);
    const fam={}; tx.filter(t=>t.kind==='expense'&&t.people?.name!=='Eu'&&t.reimbursement_status!=='paid').forEach(t=>fam[t.people?.name||'Sem pessoa']=(fam[t.people?.name||'Sem pessoa']||0)+(Number(t.installment_amount)-Number(t.amount_received||0)));
    $('#familySummary').innerHTML=Object.keys(fam).length?Object.entries(fam).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="summary-row"><span>${escapeHtml(n)}</span><strong>${brl.format(v)}</strong></div>`).join(''):'Nenhum valor pendente neste mês.';
    const cats={}; tx.filter(t=>t.kind==='expense'&&t.people?.name==='Eu').forEach(t=>{const name=state.categories.find(c=>c.id===t.category_id)?.name||'Outros'; cats[name]=(cats[name]||0)+Number(t.installment_amount)});
    $('#categorySummary').innerHTML=Object.keys(cats).length?Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([n,v])=>`<div class="summary-row"><span>${escapeHtml(n)}</span><strong>${brl.format(v)}</strong></div>`).join(''):'Sem gastos neste mês.';
  }

  function renderInvoices(){
    const m=$('#invoiceFilterMonth').value||yyyyMm(), pid=$('#invoicePersonFilter').value;
    let rows=state.transactions.filter(t=>t.kind==='expense'&&String(t.invoice_month).slice(0,7)===m&&t.people?.name!=='Eu'); if(pid) rows=rows.filter(t=>t.person_id===pid);
    const pending=rows.reduce((s,t)=>s+Math.max(0,Number(t.installment_amount)-Number(t.amount_received||0)),0);
    $('#invoiceSummary').innerHTML=`<div class="summary-row"><span>Total pendente</span><strong>${brl.format(pending)}</strong></div>`;
    $('#invoiceTable').innerHTML=rows.length?rows.map(t=>`<tr><td>${String(t.invoice_month).slice(0,7).split('-').reverse().join('/')}</td><td>${escapeHtml(t.people?.name||'')}</td><td>${escapeHtml(t.description)}</td><td>${t.installment_number}/${t.installments_total}</td><td>${brl.format(t.installment_amount)}</td><td><span class="status ${t.reimbursement_status==='paid'?'paid':'pending'}">${t.reimbursement_status==='paid'?'Pago':'Pendente'}</span></td><td><button class="btn secondary" data-paid="${t.id}">${t.reimbursement_status==='paid'?'Reabrir':'Marcar pago'}</button></td></tr>`).join(''):'<tr><td colspan="7">Nenhum lançamento.</td></tr>';
    $$('[data-paid]').forEach(b=>b.onclick=()=>togglePaid(b.dataset.paid));
  }

  async function togglePaid(id){ const t=state.transactions.find(x=>x.id===id), paid=t.reimbursement_status==='paid'; const {error}=await sb.from('transactions').update({reimbursement_status:paid?'pending':'paid',amount_received:paid?0:t.installment_amount}).eq('id',id); if(error)return alert(error.message); await loadData(); renderInvoices(); }

  function renderHistory(){
    const m=$('#historyMonth').value||yyyyMm(), k=$('#historyKind').value; let rows=state.transactions.filter(t=>String(t.invoice_month).slice(0,7)===m); if(k) rows=rows.filter(t=>t.kind===k);
    $('#historyTable').innerHTML=rows.length?rows.map(t=>`<tr><td>${dateFmt.format(new Date(t.purchase_date+'T12:00:00'))}</td><td>${escapeHtml(t.description)}</td><td>${escapeHtml(t.people?.name||'')}</td><td>${brl.format(t.installment_amount)}</td><td>${String(t.invoice_month).slice(0,7).split('-').reverse().join('/')}</td><td><button class="btn danger" data-del="${t.id}">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6">Nenhum lançamento.</td></tr>';
    $$('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir esta parcela?'))return; const {error}=await sb.from('transactions').delete().eq('id',b.dataset.del); if(error)return alert(error.message); await loadData(); renderHistory();});
  }

  function renderRegisters(){
    $('#peopleList').innerHTML=state.people.map(p=>`<span class="chip">${escapeHtml(p.name)}${p.is_self?'':'<button data-del-person="'+p.id+'">×</button>'}</span>`).join('');
    $('#cardsList').innerHTML=state.cards.map(c=>`<span class="chip">${escapeHtml(c.name)}${c.closing_day?' · fecha '+c.closing_day:''}${c.due_day?' · vence '+c.due_day:''}<button data-del-card="${c.id}">×</button></span>`).join('');
    $$('[data-del-person]').forEach(b=>b.onclick=()=>deleteRegister('people',b.dataset.delPerson)); $$('[data-del-card]').forEach(b=>b.onclick=()=>deleteRegister('cards',b.dataset.delCard));
  }
  async function deleteRegister(table,id){ const {error}=await sb.from(table).delete().eq('id',id); if(error)return alert('Não foi possível excluir. Pode haver lançamentos ligados a este cadastro.'); await loadData(); renderRegisters(); }

  function updateKindUI(){ const income=$('#transactionKind').value==='income'; ['cardField','personField','installmentsField','invoiceMonthField'].forEach(id=>$('#'+id).classList.toggle('hidden',income)); $('#recurringField').classList.toggle('hidden',!income); updatePreview(); }
  function updatePreview(){ if($('#transactionKind').value==='income'){ $('#installmentPreview').textContent=''; return; } const amount=Number($('#amount').value||0), n=Number($('#installments').value||1), m=$('#invoiceMonth').value; if(!amount||!m){$('#installmentPreview').textContent='';return;} $('#installmentPreview').textContent=n>1?`${n} parcelas de aproximadamente ${brl.format(amount/n)}, de ${m.split('-').reverse().join('/')} até ${addMonths(m,n-1).split('-').reverse().join('/')}.`:`Lançamento na fatura ${m.split('-').reverse().join('/')}.`; }

  async function saveTransaction(e){
    e.preventDefault(); const msg=$('#transactionMessage'); setMessage(msg,'Salvando...');
    const kind=$('#transactionKind').value, amount=Number($('#amount').value), purchase=$('#purchaseDate').value, description=$('#description').value.trim();
    if(!amount||!purchase||!description){setMessage(msg,'Preencha descrição, valor e data.',true);return;}
    let inserts=[];
    if(kind==='income'){
      const months=$('#recurringIncome').checked ? 12-(new Date(purchase+'T12:00:00').getMonth()) : 1;
      for(let i=0;i<months;i++){ const m=addMonths(purchase.slice(0,7),i); inserts.push({user_id:state.user.id,kind:'income',description,category_id:$('#category').value||null,payment_method:$('#paymentMethod').value,amount_total:amount,installment_number:1,installments_total:1,installment_amount:amount,purchase_date:i===0?purchase:monthStart(m),invoice_month:monthStart(m),reimbursement_status:null,amount_received:0,notes:$('#notes').value}); }
    } else {
      const n=Number($('#installments').value||1), first=$('#invoiceMonth').value||purchase.slice(0,7), base=Math.round((amount/n)*100)/100;
      const person=state.people.find(p=>p.id===$('#person').value), status=person?.is_self?null:'pending';
      for(let i=0;i<n;i++){ const val=i===n-1?Math.round((amount-base*(n-1))*100)/100:base; inserts.push({user_id:state.user.id,kind:'expense',description,category_id:$('#category').value||null,payment_method:$('#paymentMethod').value,card_id:$('#card').value||null,person_id:$('#person').value||null,amount_total:amount,installment_number:i+1,installments_total:n,installment_amount:val,purchase_date:purchase,invoice_month:monthStart(addMonths(first,i)),reimbursement_status:status,amount_received:0,notes:$('#notes').value}); }
    }
    const {error}=await sb.from('transactions').insert(inserts); if(error){setMessage(msg,error.message,true);return;} setMessage(msg,'Lançamento salvo.'); $('#transactionForm').reset(); $('#transactionKind').value='expense'; $$('.seg').forEach(x=>x.classList.toggle('active',x.dataset.kind==='expense')); setFormDefaults(); updateKindUI(); await loadData(); setTimeout(()=>nav('dashboard'),500);
  }

  function setFormDefaults(){ $('#purchaseDate').value=new Date().toISOString().slice(0,10); $('#invoiceMonth').value=yyyyMm(); $('#dashboardMonth').value||=yyyyMm(); $('#invoiceFilterMonth').value||=yyyyMm(); $('#historyMonth').value||=yyyyMm(); const self=state.people.find(x=>x.is_self); if(self) $('#person').value=self.id; }

  function exportCsv(all=false){ let rows=all?state.transactions:state.transactions.filter(t=>String(t.invoice_month).slice(0,7)===$('#historyMonth').value); const head=['Data','Tipo','Descrição','Categoria','Forma','Cartão','Pessoa','Valor total','Parcela','Total parcelas','Valor parcela','Mês fatura','Status repasse','Valor recebido','Observação']; const data=rows.map(t=>[t.purchase_date,t.kind,t.description,state.categories.find(c=>c.id===t.category_id)?.name||'',t.payment_method,t.cards?.name||'',t.people?.name||'',t.amount_total,t.installment_number,t.installments_total,t.installment_amount,t.invoice_month,t.reimbursement_status||'',t.amount_received||0,t.notes||'']); const esc=v=>'"'+String(v??'').replaceAll('"','""')+'"'; const csv='\uFEFF'+[head,...data].map(r=>r.map(esc).join(';')).join('\r\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download=`controle-financeiro-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href); }

  $('#authForm').addEventListener('submit',async e=>{e.preventDefault(); setMessage($('#authMessage'),'Entrando...'); const {error}=await sb.auth.signInWithPassword({email:$('#authEmail').value,password:$('#authPassword').value}); if(error)setMessage($('#authMessage'),error.message,true);});
  $('#signupBtn').onclick=async()=>{setMessage($('#authMessage'),'Criando conta...'); const {error}=await sb.auth.signUp({email:$('#authEmail').value,password:$('#authPassword').value}); setMessage($('#authMessage'),error?error.message:'Conta criada. Se a confirmação de e-mail estiver ativa, confirme sua caixa de entrada.',!!error);};
  $('#logoutBtn').onclick=()=>sb.auth.signOut();
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.nav)));
  $$('.seg').forEach(b=>b.onclick=()=>{ $$('.seg').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $('#transactionKind').value=b.dataset.kind; updateKindUI(); });
  ['amount','installments','invoiceMonth'].forEach(id=>$('#'+id).addEventListener('input',updatePreview));
  $('#transactionForm').addEventListener('submit',saveTransaction);
  $('#dashboardMonth').onchange=renderDashboard; $('#invoiceFilterMonth').onchange=renderInvoices; $('#invoicePersonFilter').onchange=renderInvoices; $('#historyMonth').onchange=renderHistory; $('#historyKind').onchange=renderHistory;
  $('#prevMonth').onclick=()=>{$('#dashboardMonth').value=addMonths($('#dashboardMonth').value,-1);renderDashboard()}; $('#nextMonth').onclick=()=>{$('#dashboardMonth').value=addMonths($('#dashboardMonth').value,1);renderDashboard()};
  $('#personForm').onsubmit=async e=>{e.preventDefault(); const name=$('#newPerson').value.trim(); if(!name)return; const {error}=await sb.from('people').insert({user_id:state.user.id,name}); if(error)return alert(error.message); $('#newPerson').value=''; await loadData();renderRegisters();};
  $('#cardForm').onsubmit=async e=>{e.preventDefault(); const name=$('#newCard').value.trim(); if(!name)return; const payload={user_id:state.user.id,name,closing_day:Number($('#closingDay').value)||null,due_day:Number($('#dueDay').value)||null}; const {error}=await sb.from('cards').insert(payload); if(error)return alert(error.message); e.target.reset(); await loadData();renderRegisters();};
  $('#exportCsvBtn').onclick=()=>exportCsv(false); $('#exportCsvBtn2').onclick=()=>exportCsv(true);

  let deferredPrompt=null; window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').hidden=false;}); $('#installBtn').onclick=async()=>{if(!deferredPrompt)return alert('No iPhone/iPad: Safari → Compartilhar → Adicionar à Tela de Início.'); deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('#installBtn').hidden=true;};
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));

  sb.auth.onAuthStateChange(async(_event,session)=>{ if(!session){state.user=null;show('authScreen');return;} state.user=session.user; show('mainScreen'); try{await ensureSeed(); await loadData(); setFormDefaults(); updateKindUI(); nav('dashboard');}catch(e){alert('Erro ao carregar dados: '+e.message);} });
  sb.auth.getSession().then(({data:{session}})=>{ if(!session) show('authScreen'); });
})();
