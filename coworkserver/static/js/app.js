// ================================================================
// URL: JWT토큰 or username 추출
// ================================================================
var pathToken='',currentUser='',pathPrefix='';

// 토스트 알림
function showNotification(msg, duration){
    duration = duration || 3000;
    var $t=$('<div class="toast-notification">'+msg+'</div>').css({
        position:'fixed',top:'20px',left:'50%',transform:'translateX(-50%)',
        zIndex:9999,background:'#1a1a2e',color:'#fff',padding:'10px 24px',
        borderRadius:'8px',fontSize:'13px',fontFamily:'var(--sans)',
        boxShadow:'0 4px 16px rgba(0,0,0,.2)',opacity:0,transition:'opacity .3s',
        maxWidth:'90vw',textAlign:'center',lineHeight:'1.5'
    });
    $('body').append($t);
    setTimeout(function(){$t.css('opacity',1)},10);
    setTimeout(function(){$t.css('opacity',0);setTimeout(function(){$t.remove()},300)},duration);
}
(function(){
    var segs=location.pathname.replace(/\/+$/,'').split('/').filter(Boolean);
    if(segs.length>=1&&!['api','static','ws'].includes(segs[0])){
        pathToken=segs[0]; pathPrefix='/'+pathToken;
    }
})();
function apiUrl(ep){return pathPrefix+ep}
function apiUrlO(ep){var url=pathPrefix+ep;if(shareMode){url+=(url.indexOf('?')>=0?'&':'?')+'owner='+encodeURIComponent(shareMode.owner)}return url}
function wsUrl(){return(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+(pathToken?'/ws/chat/'+pathToken:'/ws/chat')}
function previewUrl(fp){var base=pathPrefix+'/api/preview/'+fp;if(shareMode)base+='?owner='+encodeURIComponent(shareMode.owner);return base}
function genDockey(filename){
    var ext=filename.split('.').pop().toLowerCase();
    var chars='0123456789abcdef',h='';
    for(var i=0;i<32;i++) h+=chars.charAt(Math.floor(Math.random()*chars.length));
    return 'upload_'+h+'.'+ext;
}
function openOfficeViewer(fp){
    var fname=fp.split('/').pop();
    var payload={path:fp};
    if(shareMode) payload.owner=shareMode.owner;
    $.ajax({url:apiUrl('/api/temp-link'),type:'POST',contentType:'application/json',
        data:JSON.stringify(payload),
        success:function(r){
            var pubUrl=(window._kportalUrl||'')+r.url;
            var dockey=genDockey(fname);
            var viewerUrl=(window._kportalUrl||'')+'/officeview/ov.jsp?url='+encodeURIComponent(pubUrl)+'&filename='+encodeURIComponent(fname)+'&dockey='+encodeURIComponent(dockey);
            window.open(viewerUrl,'_blank');
        },
        error:function(){window.open(apiUrlO('/api/download?path='+encodeURIComponent(fp)),'_blank')}
    });
}

var ws=null,currentPath='.',isProcessing=false,$currentBubble=null,currentSessionId='',streamingRawText='',lastSentMessage='';
var shareMode=null; // null=내 폴더, {owner:'xxx',rootPath:'yyy',perm:'read|write'} = 공유 모드
var activeProjectId='',activeProjectName=''; // 현재 활성 프로젝트
var _modifiedFiles=[]; // 작업 중 변경된 파일 수집
var TOOL_ICONS={list_files:'📂',read_file:'📄',write_file:'✏️',edit_file:'🔧',delete_file:'🗑️',create_directory:'📁',run_command:'⚡',search_files:'🔍',file_info:'ℹ️',read_excel:'📊',web_search:'🌐',write_temp_file:'📝',figma_get_file:'🎨',figma_get_images:'🖼️',figma_get_styles:'🎭'};
var FILE_ICONS={py:'🐍',js:'📜',ts:'📘',java:'☕',html:'🌐',css:'🎨',json:'📋',md:'📝',txt:'📄',yml:'⚙️',sh:'⚡',sql:'🗃️',csv:'📊',xlsx:'📊',xls:'📊',docx:'📄',jpg:'🖼️',png:'🖼️',gif:'🖼️',zip:'📦'};

// ================================================================
// Modal
// ================================================================
function showModal(t,b,btns){$('#modal-title').text(t);$('#modal-body').html(b);var $b=$('#modal-btns').empty();$.each(btns,function(i,x){$('<button class="modal-btn '+(x.cls||'')+'">'+x.label+'</button>').on('click',function(){closeModal();if(x.action)x.action()}).appendTo($b)});$('#modal').addClass('show')}
function closeModal(){$('#modal').removeClass('show')}
$(document).on('keydown',function(e){if(e.key==='Escape')closeModal()});

// ================================================================
// WebSocket + 재접속 복원
// ================================================================
var _authFailed = false;  // 인증 실패 시 재접속 방지

// 만료/인증실패 전체 화면 안내 오버레이
function showAuthOverlay(isExpired){
    _authFailed=true;
    if(ws){try{ws.close()}catch(e){}} ws=null;
    $('#auth-overlay').remove();
    var icon = isExpired ? '⏱' : '🔐';
    var title = isExpired ? '세션이 만료되었습니다' : '인증에 실패했습니다';
    var desc = isExpired
        ? '보안을 위해 일정 시간이 지나면 자동으로 세션이 만료됩니다.<br>아래 버튼을 눌러 K-Portal에서 다시 접속해주세요.'
        : '유효하지 않은 인증 정보입니다.<br>K-Portal 통합인증을 통해 다시 접속해주세요.';
    var portalUrl = window._kportalUrl || '';
    var btns = '';
    if(portalUrl){
        btns += '<a class="auth-ov-btn primary" href="'+portalUrl+'" target="_top">K-Portal로 이동</a>';
    }
    btns += '<button class="auth-ov-btn" onclick="window.close()">현재 창 닫기</button>';

    var html = '<div id="auth-overlay" class="auth-overlay">' +
        '<div class="auth-ov-box">' +
            '<div class="auth-ov-icon">'+icon+'</div>' +
            '<h2 class="auth-ov-title">'+title+'</h2>' +
            '<p class="auth-ov-desc">'+desc+'</p>' +
            '<div class="auth-ov-info">' +
                '<span class="material-icons-outlined" style="font-size:16px;vertical-align:middle">info</span> ' +
                (isExpired ? '로그아웃이 아닌 보안 정책에 의한 자동 만료입니다' : '직접 URL 접속이나 변조된 토큰은 허용되지 않습니다') +
            '</div>' +
            '<div class="auth-ov-actions">'+btns+'</div>' +
        '</div>' +
    '</div>';
    $('body').append(html);
}

// 전역 AJAX 401 처리: 모든 API 호출에서 JWT 만료 감지
$(document).ajaxError(function(e, xhr){
    if(xhr.status === 401 && !_authFailed){
        var detail = '';
        try { detail = xhr.responseJSON?.detail || ''; } catch(e){}
        var isExpired = detail.indexOf('만료') >= 0;
        showAuthOverlay(isExpired);
    }
});

function connectWS(){
    if(_authFailed) return;  // 인증 실패 시 재접속 안 함
    ws=new WebSocket(wsUrl());
    ws.onopen=function(){$('#conn-status').text('연결됨');loadChatLogs(true);loadSlashSkills()};
    ws.onclose=function(e){
        if(e.code===4001){_authFailed=true;$('#conn-status').text('인증 만료');return}
        $('#conn-status').text('재접속...');if(!_authFailed)setTimeout(connectWS,2000)
    };
    ws.onerror=function(){};
    ws.onmessage=function(e){handleMsg(JSON.parse(e.data))};
}
function handleMsg(d){
    // 모든 메시지 수신 시 멈춤 타이머 리셋
    if(d.type !== 'ping' && isProcessing) _resetStallTimer();
    switch(d.type){
        case 'ping':
            if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'pong'}));
            return;
        case 'session_init':
            currentSessionId=d.session_id;
            if(d.username)currentUser=d.username;
            if(currentUser){
                
                if(!$('#user-badge').data('resolved')){
                    $.getJSON(apiUrl('/api/org/user'),{lid:currentUser},function(r){
                        if(r.found){
                            $('#user-badge').text(r.name+' '+r.dept).data('resolved',true).show();
                        } else {
                            $('#user-badge').text(currentUser).show();
                        }
                        if(window._isAdmin){$('#btn-admin').show()}
                    }).fail(function(){
                        $('#user-badge').text(currentUser).show();
                        if(window._isAdmin){$('#btn-admin').show()}
                    })
                }
            }
            break;
        case 'auth_expired':
            showAuthOverlay(true);
            break;
        case 'auth_error':
            showAuthOverlay(false);
            break;
        case 'reconnect':
            // 재접속: 진행 중이던 작업 복원
            $('#welcome').hide();isProcessing=true;$('#send-btn').prop('disabled',true).hide();$('#stop-btn').show();
            showGlobalProgress('AI가 요청을 분석하고 있습니다...');
            ensureBubble();
            $currentBubble.append('<div class="reconnect-banner"><span class="material-icons-outlined">sync</span> 이전 작업을 복원 중입니다...</div>');
            scrollBottom();
            break;
        case 'progress':hideWorking();updateProgress(d.step,d.message);showGlobalProgress(d.message);break;
        case 'model_info':
            var mLabel=d.model==='Opus'?'🟣 Opus':'🔵 Sonnet';
            var kInfo='Key #'+d.key_index+'/'+d.key_total;
            var switched=d.switched?' (키 전환)':'';
            showGlobalProgress(mLabel+' · '+kInfo+switched);
            break;
        case 'skills_info':
            ensureBubble();
            var matchedSkills=d.skills.filter(function(s){return s.matched});
            var unmatchedSkills=d.skills.filter(function(s){return !s.matched});
            $currentBubble.find('.skills-banner').remove();
            if(matchedSkills.length){
                var skChips=matchedSkills.map(function(s){
                    var icon=s.shared?'🤝':'📘';
                    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px 3px 8px;background:linear-gradient(135deg,rgba(74,124,255,.1),rgba(99,102,241,.1));border:1px solid rgba(74,124,255,.2);border-radius:20px;font-size:11px;font-weight:600;color:var(--blue);white-space:nowrap">'+
                    icon+' '+esc(s.name)+
                    '<span style="font-weight:400;color:var(--tx3);font-size:10px">'+s.files+'개</span>'+
                    '</span>';
                }).join(' ');
                $currentBubble.append(
                    '<div class="skills-banner" style="padding:12px 14px;margin-bottom:10px;background:linear-gradient(135deg,rgba(99,102,241,.04),rgba(74,124,255,.04));border:1px solid rgba(99,102,241,.1);border-radius:var(--radius-sm);font-size:12px;line-height:1.7">'+
                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'+
                    '<span style="font-size:15px">🧠</span>'+
                    '<span style="font-weight:600;color:var(--blue)">스킬 기반 응답</span></div>'+
                    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">'+skChips+'</div>'+
                    '<div style="color:var(--tx2);font-size:11px">요청하신 내용에 따라 위 스킬을 활용하여 진행하겠습니다.</div>'+
                    '</div>'
                );
            } else if(unmatchedSkills.length){
                $currentBubble.append(
                    '<div class="skills-banner" style="padding:8px 12px;margin-bottom:8px;background:rgba(249,115,22,.04);border:1px solid rgba(249,115,22,.12);border-radius:var(--radius-sm);font-size:11px;line-height:1.5;color:var(--tx2)">'+
                    '📋 등록된 스킬 '+unmatchedSkills.length+'개가 있으나 이번 요청과 직접 관련된 스킬이 없어 일반 모드로 진행합니다.'+
                    '</div>'
                );
            }
            scrollBottom();
            break;
        case 'rate_limit':
            ensureBubble();removeProgress();
            showGlobalProgress('⏳ API 한도 초과 — 대기 중...');
            var rlId='rate-limit-'+Date.now();
            $currentBubble.find('.rate-limit-banner').remove();
            $currentBubble.append(
                '<div class="rate-limit-banner" id="'+rlId+'">'+
                '<div class="rl-header">⏳ API 사용량 한도 초과</div>'+
                '<div class="rl-body">'+esc(d.message)+' — <span class="rl-countdown">'+d.wait+'</span>초 후 자동 재시도</div>'+
                '<div class="rl-progress"><div class="rl-progress-fill" style="width:100%"></div></div>'+
                '</div>'
            );
            scrollBottom();
            break;
        case 'rate_limit_tick':
            var $rl=$currentBubble.find('.rate-limit-banner').last();
            if($rl.length){
                $rl.find('.rl-countdown').text(d.remaining);
                var pct=((d.remaining/d.total)*100);
                $rl.find('.rl-progress-fill').css('width', pct+'%');
            }
            showGlobalProgress('⏳ API 한도 초과 — '+d.remaining+'초 후 재시도 ('+d.retry+'/'+d.max_retry+')');
            break;
        case 'rate_limit_resume':
            $currentBubble.find('.rate-limit-banner').last().remove();
            updateProgress(0,'재시도 중...');
            showGlobalProgress('재시도 중...');
            break;
        case 'text_start':ensureBubble();removeProgress();hideWorking();streamingRawText='';
            showGlobalProgress(T('progress_generating','응답을 생성하고 있습니다...'));
            if(!$currentBubble.find('.streaming-text').length){
                $currentBubble.append('<div class="streaming-wrap"><span class="streaming-text"></span><span class="streaming-cursor"></span></div>');
                $currentBubble.append('<div class="streaming-status" id="streaming-status"><div class="wi-spinner"></div><span class="wi-text">'+T('progress_generating','응답을 생성하고 있습니다...')+'</span></div>');
            }
            break;
        case 'text_delta':ensureBubble();removeProgress();streamingRawText+=d.content;
            $currentBubble.find('.streaming-text').html(marked.parse(streamingRawText));scrollBottom();break;
        case 'text_end':
            if(streamingRawText&&$currentBubble){
                $currentBubble.find('.streaming-cursor').remove();
                $currentBubble.find('#streaming-status').remove();
                var parsed=marked.parse(streamingRawText);
                $currentBubble.find('.streaming-wrap').replaceWith(parsed);
                streamingRawText='';
            }
            showWorking(T('progress_next_step','AI가 다음 작업을 준비하고 있습니다...'));
            showGlobalProgress(T('progress_next_step','AI가 다음 작업을 준비하고 있습니다...'));
            scrollBottom();
            break;
        case 'text':ensureBubble();removeProgress();$currentBubble.append(marked.parse(d.content));scrollBottom();break;
        case 'tool_start':ensureBubble();removeProgress();hideWorking();showGlobalProgress('🔧 '+(d.tool||T('progress_tool_exec','도구'))+' 실행 중...');break;
        case 'tool_call':ensureBubble();removeProgress();hideWorking();appendToolCard(d.tool,d.input,d.id,d.tool_index,d.tool_total);showGlobalProgress((d.tool_index||'')+' '+d.tool+' 실행 중...');scrollBottom();break;
        case 'tool_result':updateToolResult(d.id,d.tool,d.success,d.result,d.tool_index,d.tool_total);
            if(['write_file','delete_file','create_directory','edit_file'].includes(d.tool))refreshFiles();
            showWorking(T('progress_result_analysis','작업 결과를 분석하고 있습니다...'));showGlobalProgress(T('progress_result_analysis','작업 결과를 분석하고 있습니다...'));scrollBottom();break;
        case 'error':ensureBubble();removeProgress();hideWorking();
            var errHtml='<div class="err-box">⚠️ '+esc(d.content)+'</div>';
            if(d.suggest_compress){errHtml='<div class="err-box">⚠️ '+esc(d.content)+'<br><button onclick="compressContext()" style="margin-top:8px;padding:4px 12px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">🗜️ 대화 압축하기</button></div>'}
            $currentBubble.append(errHtml);scrollBottom();break;
        case 'compress_progress':
            showGlobalProgress('🗜️ '+d.message+' ('+d.progress+'%)');
            if($('#compress-modal').length){$('#compress-bar').css('width',d.progress+'%');$('#compress-msg').text(d.message)}
            break;
        case 'compress_result':
            hideGlobalProgress();
            if($('#compress-modal').length)$('#compress-modal').remove();
            if(d.success){
                ensureBubble();
                $currentBubble.append('<div style="text-align:center;padding:10px;margin:8px 0;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:12px;color:#065f46">✅ '+esc(d.message)+'</div>');
            } else {
                ensureBubble();
                $currentBubble.append('<div class="err-box">⚠️ '+esc(d.message)+'</div>');
            }
            scrollBottom();finishProcessing();break;
        case 'done':
            removeProgress();hideWorking();hideGlobalProgress();$('.reconnect-banner').remove();
            // 변경된 파일 요약 패널
            if(_modifiedFiles.length>0 && $currentBubble){
                // 중복 제거 (같은 파일 여러 번 수정된 경우 마지막만)
                var seen={}, unique=[];
                for(var i=_modifiedFiles.length-1;i>=0;i--){
                    if(!seen[_modifiedFiles[i].path]){seen[_modifiedFiles[i].path]=1;unique.unshift(_modifiedFiles[i])}
                }
                // 프로젝트 모드: 경로 앞에 _projects/{projectId}/ 추가
                var projPrefix = activeProjectId ? '_projects/'+activeProjectId+'/' : '';
                function dlPath(p){ return projPrefix + p; }

                var panel='<div class="modified-files-panel">';
                panel+='<div class="mfp-header"><span class="mfp-icon">📋</span><span class="mfp-title">변경된 파일 ('+unique.length+'개)</span>';
                if(unique.length>1) panel+='<a class="mfp-dl-all" href="'+apiUrlO('/api/download-multi?paths='+encodeURIComponent(unique.map(function(f){return dlPath(f.path)}).join(',')))+'" title="일괄 다운로드">📦 일괄 다운로드</a>';
                panel+='</div><div class="mfp-list">';
                unique.forEach(function(f){
                    var ext=f.path.split('.').pop().toLowerCase();
                    var icon=FILE_ICONS[ext]||'📄';
                    var fname=f.path.split('/').pop();
                    var dir=f.path.indexOf('/')>=0?f.path.substring(0,f.path.lastIndexOf('/')):'';
                    var toolLabel=f.tool==='write_file'?'생성':'수정';
                    var badgeCls=f.tool==='write_file'?'new':'edit';
                    var previewable=/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql)$/.test(ext);
                    var editable=/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env)$/.test(ext);
                    var realPath = dlPath(f.path);
                    panel+='<div class="mfp-item">';
                    panel+='<span class="mfp-badge '+badgeCls+'">'+toolLabel+'</span>';
                    panel+='<span class="mfp-file-icon">'+icon+'</span>';
                    panel+='<div class="mfp-file-meta"><span class="mfp-file-name" title="'+esc(f.path)+'">'+esc(fname)+'</span>';
                    if(dir) panel+='<span class="mfp-file-dir">'+esc(dir)+'</span>';
                    panel+='</div>';
                    panel+='<div class="mfp-actions">';
                    if(previewable) panel+='<a class="mfp-btn" href="'+previewUrl(realPath)+'" target="_blank">미리보기</a>';
                    if(editable) panel+='<a class="mfp-btn" href="'+previewUrl(realPath)+(previewUrl(realPath).indexOf('?')>-1?'&':'?')+'edit=1" target="_blank">편집</a>';
                    panel+='<a class="mfp-btn dl" href="'+apiUrlO('/api/download?path='+encodeURIComponent(realPath))+'">⬇</a>';
                    panel+='</div></div>';
                });
                panel+='</div></div>';
                $currentBubble.append(panel);
                scrollBottom();
            }
            finishProcessing();_modifiedFiles=[];
            if(d.session_id)currentSessionId=d.session_id;
            prependNewChatLog(d.task_id);refreshFiles();
            if(activeProjectId)loadProjectOutputs(activeProjectId);
            break;
        case 'cancelled':
            removeProgress();hideWorking();hideGlobalProgress();$('.reconnect-banner').remove();
            _clearStallTimer();$('#stall-notice').remove();_stallNoticeShown=false;
            // 실행 중인 도구 카드 모두 중지 표시로 변경
            if($currentBubble){
                $currentBubble.find('.tool-card.is-running').each(function(){
                    $(this).removeClass('is-running');
                    $(this).find('.tc-status').removeClass('running').addClass('fail').html('⏹ 중지됨');
                    $(this).find('.tc-result').text('작업이 중지되었습니다.');
                });
                // 스트리밍 애니메이션 모두 제거
                $currentBubble.find('.streaming-cursor').remove();
                $currentBubble.find('#streaming-status').remove();
                $currentBubble.find('.streaming-status').remove();
                if(streamingRawText){
                    var parsed=marked.parse(streamingRawText);
                    $currentBubble.find('.streaming-wrap').replaceWith(parsed);
                    streamingRawText='';
                }
                $currentBubble.append('<div class="err-box" style="border-color:var(--orange);background:rgba(245,158,11,.06)">'+T('progress_cancelled','⏹ 작업이 중지되었습니다.')+'</div>');
            } else {
                ensureBubble();
                $currentBubble.append('<div class="err-box" style="border-color:var(--orange);background:rgba(245,158,11,.06)">'+T('progress_cancelled','⏹ 작업이 중지되었습니다.')+'</div>');
            }
            finishProcessing();scrollBottom();
            // ★ 중지된 대화도 목록에서 확인할 수 있도록 갱신
            if(d.task_id) prependNewChatLog(d.task_id);
            refreshFiles();
            break;
        case 'cleared':currentSessionId=d.session_id;$('#messages').html($('#welcome').length?$('#welcome').prop('outerHTML'):_welcomeHtml);applyI18n();finishProcessing();loadChatLogs(true);break;
        case 'session_loaded':
            loadSessionMessages(d.messages);
            if(d.current_folder && d.current_folder!=='.'){
                currentPath=d.current_folder;refreshFiles();
                var $folder=$('<div style="text-align:center;padding:8px;margin:8px 0;background:#f0fdf4;border-radius:8px;font-size:11px;color:#15803d">📁 작업 폴더가 <b>'+esc(d.current_folder)+'</b>(으)로 설정되었습니다.</div>');
                $('#messages').append($folder);
            }
            // 프로젝트 대화인 경우 프로젝트 모드 활성화
            if(d.project_id && d.project){
                setActiveProject(d.project_id, d.project.name);
                var projDesc = d.project.description ? ' — ' + esc(d.project.description) : '';
                var $projInfo=$('<div style="text-align:center;padding:10px 14px;margin:8px 0;background:linear-gradient(135deg,#F0FFF4,#E6FFFA);border:1px solid rgba(16,185,129,.2);border-radius:10px;font-size:12px;color:#065F46;display:flex;align-items:center;justify-content:center;gap:6px">'+
                    '<span style="font-size:16px">📁</span> <strong>'+esc(d.project.name)+'</strong> 프로젝트 대화'+projDesc+'</div>');
                $('#messages').prepend($projInfo);
            } else if(d.project_id && !d.project){
                // 프로젝트가 삭제된 경우
                var $projWarn=$('<div style="text-align:center;padding:8px;margin:8px 0;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;font-size:11px;color:#92400E">⚠️ 이 대화는 삭제된 프로젝트에서 작성되었습니다.</div>');
                $('#messages').prepend($projWarn);
            } else {
                // 일반 대화 → 프로젝트 해제
                if(activeProjectId){activeProjectId='';activeProjectName='';$('#project-badge').remove()}
            }
            if(d.context_restored>0){
                var $info=$('<div style="text-align:center;padding:8px;margin:8px 0;background:#eef2ff;border-radius:8px;font-size:11px;color:#4b5563">💡 이 대화의 맥락이 복원되었습니다 (이전 '+d.context_restored+'회 대화 포함). 이어서 질문하면 이전 내용을 참고합니다.</div>');
                $('#messages').append($info);scrollBottom();
            }
            break;
    }
}
function showWorking(msg){ensureBubble();hideWorking();$currentBubble.append('<div class="working-indicator" id="working-ind"><div class="wi-spinner"></div><span class="wi-text">'+(msg||'작업을 진행하고 있습니다...')+'</span></div>');scrollBottom()}
function compressContext(){
    if(!ws||ws.readyState!==1){alert('서버에 연결되어 있지 않습니다.');return}
    // 모달 표시
    var modal='<div id="compress-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:99999;display:flex;align-items:center;justify-content:center"><div style="background:#fff;border-radius:12px;padding:24px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2)"><div style="font-size:32px;margin-bottom:12px">🗜️</div><h3 style="margin:0 0 8px;font-size:16px;color:#1e293b">대화를 계속하기 위해 압축하고 있습니다...</h3><p id="compress-msg" style="margin:0 0 16px;font-size:13px;color:#64748b">준비 중...</p><div style="background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden"><div id="compress-bar" style="background:linear-gradient(90deg,#3b82f6,#2563eb);height:100%;width:0%;transition:width .3s;border-radius:8px"></div></div></div></div>';
    $('body').append(modal);
    ws.send(JSON.stringify({type:'compress_context'}));
}
function hideWorking(){$('#working-ind').remove()}
function showGlobalProgress(msg){
    var $gp=$('#global-progress');
    if(!$gp.length){$('#messages').after('<div class="global-progress" id="global-progress"><div class="gp-bar"></div><div class="gp-dot"></div><span class="gp-text"></span></div>')}
    $('#global-progress .gp-text').text(msg||'AI가 작업을 진행하고 있습니다...');
}
function hideGlobalProgress(){$('#global-progress').remove()}
function ensureBubble(){if($currentBubble&&$currentBubble.length)return;$('#welcome').hide();var $m=$('<div class="msg assistant"><div class="msg-bubble"></div></div>');$('#messages').append($m);$currentBubble=$m.find('.msg-bubble')}
function appendToolCard(name,input,id,toolIdx,toolTotal){
    var safe='tc-'+(id||'').replace(/[^a-zA-Z0-9_-]/g,'_');
    var counter=(toolIdx&&toolTotal&&toolTotal>1)?'<span class="tc-counter">['+toolIdx+'/'+toolTotal+']</span> ':'';
    $currentBubble.append('<div class="tool-card is-running" id="'+safe+'" data-tool-id="'+esc(id||'')+'"><div class="tc-head"><span>'+(TOOL_ICONS[name]||'🔧')+'</span><span class="tc-name">'+counter+name+'</span><span class="tc-status running"><span class="tc-spinner"></span> '+(toolIdx&&toolTotal&&toolTotal>1?toolIdx+'/'+toolTotal+' 실행 중...':'실행 중...')+'</span></div><div class="tc-body"><strong>입력:</strong>\n'+esc(JSON.stringify(input,null,2))+'\n\n<strong>결과:</strong>\n<span class="tc-result">대기 중...</span></div></div>');
    $('#'+safe+' .tc-head').on('click',function(){$(this).next('.tc-body').toggleClass('open')});
}
function updateToolResult(id,name,ok,result,toolIdx,toolTotal){
    var $c=$currentBubble?$currentBubble.find('[data-tool-id="'+id+'"]'):null;if(!$c||!$c.length)return;
    $c.closest('.tool-card').removeClass('is-running');
    var doneLabel=ok?'✓ 완료':'✗ 실패';
    if(toolIdx&&toolTotal&&toolTotal>1) doneLabel=(ok?'✓':'✗')+' '+toolIdx+'/'+toolTotal+' '+(ok?'완료':'실패');
    $c.find('.tc-status').removeClass('running').addClass(ok?'ok':'fail').html(doneLabel);
    var t=JSON.stringify(result,null,2);if(t.length>3000)t=t.substring(0,3000)+'\n...';$c.find('.tc-result').text(t);
    // 변경된 파일 수집 (done 시 요약 패널에서 사용)
    if(ok&&(name==='write_file'||name==='edit_file')&&result&&result.path){
        _modifiedFiles.push({path:result.path, tool:name, size:result.size||0});
    }
}
function updateProgress(s,m){var $p=$('#progress-indicator');if(!$p.length){ensureBubble();$currentBubble.append('<div id="progress-indicator" class="progress-bar"><div class="pb-dots"><span></span><span></span><span></span></div><span class="pb-text"></span></div>');$p=$('#progress-indicator')}$p.find('.pb-text').text(m)}
function removeProgress(){$('#progress-indicator').remove()}
// ============ 첨부 파일 관리 ============
var pendingAttachments=[]; // [{file, name, size, path, uploaded, thumb}]

function addAttachment(file){
    var id='att-'+Date.now()+'-'+Math.random().toString(36).substr(2,5);
    var isImage=file.type&&file.type.startsWith('image/');
    var item={id:id, file:file, name:file.name, size:file.size, path:null, uploaded:false, thumb:null, isImage:isImage, base64:null, mediaType:file.type||'application/octet-stream'};
    if(isImage){
        var reader=new FileReader();
        reader.onload=function(e){
            var dataUrl=e.target.result;
            item.thumb=dataUrl;
            // base64 데이터 추출 (data:image/png;base64,xxx → xxx)
            item.base64=dataUrl.split(',')[1]||'';
            item.mediaType=dataUrl.split(';')[0].split(':')[1]||'image/png';
            renderAttachments();
        };
        reader.readAsDataURL(file);
    }
    pendingAttachments.push(item);
    renderAttachments();
    uploadAttachment(item);
}

function uploadAttachment(item){
    var fd=new FormData();
    fd.append('file',item.file,item.name);
    $.ajax({url:apiUrl('/api/upload-attach'),type:'POST',data:fd,processData:false,contentType:false,
        success:function(r){
            item.path=r.path||('_temp/'+item.name);
            item.uploaded=true;
            renderAttachments();
        },
        error:function(){
            pendingAttachments=pendingAttachments.filter(function(a){return a.id!==item.id});
            renderAttachments();
            showNotification('파일 업로드 실패: '+item.name);
        }
    });
}

function removeAttachment(id){
    pendingAttachments=pendingAttachments.filter(function(a){return a.id!==id});
    renderAttachments();
}

function renderAttachments(){
    var $p=$('#attach-preview');
    $p.empty();
    if(!pendingAttachments.length){$p.removeClass('has-files');return}
    $p.addClass('has-files');
    pendingAttachments.forEach(function(item){
        var icon=item.thumb?'<img src="'+item.thumb+'">':'<span style="font-size:20px">📄</span>';
        var sizeStr=item.size<1024?(item.size+'B'):item.size<1048576?(Math.round(item.size/1024)+'KB'):(Math.round(item.size/1048576*10)/10+'MB');
        var cls='attach-item'+(item.uploaded?'':' uploading');
        var $item=$('<div class="'+cls+'" id="'+item.id+'">'+icon+'<div><div class="attach-name" title="'+esc(item.name)+'">'+esc(item.name)+'</div><div class="attach-size">'+sizeStr+'</div></div><button class="attach-remove" title="제거">✕</button></div>');
        $item.find('.attach-remove').on('click',function(){removeAttachment(item.id)});
        $p.append($item);
    });
}

function clearAttachments(){pendingAttachments=[];renderAttachments()}

function sendMessage(){
    var text=$.trim($('#msg-input').val());
    var hasAttach=pendingAttachments.length>0;
    if((!text&&!hasAttach)||isProcessing)return;
    // 이미지와 일반 파일 분리
    var imageAttach=pendingAttachments.filter(function(a){return a.uploaded&&a.isImage&&a.base64});
    var fileAttach=pendingAttachments.filter(function(a){return a.uploaded&&a.path&&!a.isImage});
    // 일반 파일 첨부 정보
    var attachInfo='';
    if(fileAttach.length){
        attachInfo='\n\n[첨부 파일 '+fileAttach.length+'개]\n';
        fileAttach.forEach(function(a){attachInfo+='- '+a.path+' ('+a.name+')\n'});
        attachInfo+=T('attach_ref','위 첨부 파일들을 참고하여 작업해주세요.');
    }
    if(imageAttach.length&&!text) text=T('image_analyze','이 이미지를 분석해주세요.');
    var fullMessage=text+attachInfo;
    lastSentMessage=text;
    isProcessing=true;$currentBubble=null;_modifiedFiles=[];$('#send-btn').prop('disabled',true).hide();$('#stop-btn').show();$('#welcome').hide();
    // 사용자 메시지 표시 (첨부 파일 뱃지 포함)
    var $userBubble=$('<div class="msg user"><div class="msg-bubble"></div></div>');
    var bubbleContent=esc(text);
    if(hasAttach){
        var badges='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">';
        pendingAttachments.forEach(function(a){
            var icon=a.isImage?'🖼':'📎';
            badges+='<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:rgba(255,255,255,.15);border-radius:4px;font-size:11px">'+icon+' '+esc(a.name)+'</span>';
        });
        badges+='</div>';
        bubbleContent+=badges;
    }
    $userBubble.find('.msg-bubble').html(bubbleContent);
    $userBubble.appendTo('#messages');scrollBottom();
    var payload={message:fullMessage,currentFolder:currentPath};
    if(shareMode)payload.shareOwner=shareMode.owner;
    if(selectedForcedSkill)payload.forcedSkill=selectedForcedSkill;
    if(activeProjectId)payload.projectId=activeProjectId;
    // 이미지가 있으면 base64 데이터 포함
    if(imageAttach.length){
        payload.images=imageAttach.map(function(a){
            return {data:a.base64,media_type:a.mediaType||'image/png',name:a.name};
        });
    }
    ws.send(JSON.stringify(payload));
    _resetStallTimer();  // 멈춤 감지 타이머 시작
    $('#msg-input').val('');autoResize($('#msg-input')[0]);
    clearAttachments();
    selectedForcedSkill=null;$('#skill-mention').remove();
}
function finishProcessing(){isProcessing=false;$currentBubble=null;$('#send-btn').prop('disabled',false).show();$('#stop-btn').hide();_clearStallTimer();$('#stall-notice').remove()}

// ================================================================
// 멈춤 감지 (Stall Detection)
// AI 응답이 60초 이상 없으면 안내 메시지 표시
// ================================================================
var _stallTimer=null;
var _stallNoticeShown=false;
var STALL_TIMEOUT=60000; // 60초

function _resetStallTimer(){
    _clearStallTimer();
    _stallNoticeShown=false;
    $('#stall-notice').remove();
    if(isProcessing){
        _stallTimer=setTimeout(function(){
            _showStallNotice();
        }, STALL_TIMEOUT);
    }
}
function _clearStallTimer(){
    if(_stallTimer){clearTimeout(_stallTimer);_stallTimer=null}
}
function _showStallNotice(){
    if(_stallNoticeShown||!isProcessing)return;
    _stallNoticeShown=true;
    // 채팅 영역 하단에 안내 표시
    if($currentBubble){
        $currentBubble.append(
            '<div id="stall-notice" class="stall-notice">'+
            '<div class="stall-icon">⏸</div>'+
            '<div class="stall-body">'+
            '<div class="stall-title">응답 대기 중입니다</div>'+
            '<div class="stall-desc">AI가 복잡한 작업을 처리하고 있어 시간이 걸리고 있습니다. <strong>기다리시면 자동으로 완료</strong>됩니다.<br>오랜 시간 진행되지 않는 경우, "계속 진행 요청"을 클릭하면 중단된 시점부터 다시 시작합니다. 다만 서버 상태에 따라 바로 진행되지 않을 수 있습니다.</div>'+
            '<div class="stall-actions">'+
            '<button class="stall-btn" onclick="_dismissStall()">확인</button>'+
            '<button class="stall-btn primary" onclick="_sendContinue()">▶ 계속 진행 요청</button>'+
            '<button class="stall-btn danger" onclick="$(\'#stop-btn\').click()">⏹ 작업 중지</button>'+
            '</div></div></div>'
        );
        scrollBottom();
    }
}
function _sendContinue(){
    // 현재 작업을 중지하고 "계속 진행" 메시지 전송
    $('#stall-notice').remove();
    _stallNoticeShown=false;
    _clearStallTimer();
    // stop 후 다시 전송
    if(ws && ws.readyState === WebSocket.OPEN){
        ws.send(JSON.stringify({type:'cancel'}));
    }
    // cancel → 서버에서 중간 히스토리 저장 완료 대기 후 메시지 전송
    setTimeout(function(){
        isProcessing=false;$currentBubble=null;$('#send-btn').prop('disabled',false).show();$('#stop-btn').hide();
        $('#msg-input').val('이전 작업이 중단되었습니다. 중단된 시점부터 이어서 계속 진행해주세요. 이미 완료된 작업은 반복하지 말고, 남은 작업만 수행하세요.');
        sendMessage();
    }, 1500);
}
function _dismissStall(){
    $('#stall-notice').remove();
    // 30초 후 다시 표시
    _stallNoticeShown=false;
    _stallTimer=setTimeout(function(){
        _showStallNotice();
    }, 30000);
}

// ================================================================
// 슬래시 명령어 - 스킬 선택 팝업
// ================================================================
var _slashSkillsCache=[];
var _slashIdx=-1;
var _slashFiltered=[];
var selectedForcedSkill=null;

function loadSlashSkills(cb){
    $.getJSON(apiUrl('/api/skills'),function(sk){
        _slashSkillsCache=[];
        if(sk.my_skills) sk.my_skills.forEach(function(s){
            _slashSkillsCache.push({name:s.name,desc:s.description||'',owner:s.owner||'',type:'my',id:s._id,active:s.active!==false});
        });
        if(sk.shared_skills) sk.shared_skills.forEach(function(s){
            _slashSkillsCache.push({name:s.name,desc:s.description||'',owner:s.owner||'',type:'shared',id:s._id,active:true});
        });
        if(cb) cb();
    }).fail(function(){_slashSkillsCache=[]});
}

function showSlashPopup(filter){
    var q=(filter||'').toLowerCase();
    _slashFiltered=_slashSkillsCache.filter(function(s){
        if(!s.active) return false;
        if(!q) return true;
        return s.name.toLowerCase().indexOf(q)>-1||(s.desc&&s.desc.toLowerCase().indexOf(q)>-1);
    });
    if(!_slashFiltered.length){hideSlashPopup();return}
    _slashIdx=Math.max(0,Math.min(_slashIdx,_slashFiltered.length-1));
    var $pop=$('#slash-popup');
    if(!$pop.length){
        $pop=$('<div id="slash-popup"></div>');
        $('#input-area').append($pop);
    }
    var html='<div class="slash-hd"><span>📚 스킬 선택</span><span class="slash-hint">↑↓ 이동 · Enter 선택 · Esc 닫기</span></div><div class="slash-list">';
    _slashFiltered.forEach(function(s,i){
        var badge=s.type==='shared'?'<span class="sl-badge shared">공유</span>':'<span class="sl-badge my">내 스킬</span>';
        var cls='slash-row'+(i===_slashIdx?' active':'');
        html+='<div class="'+cls+'" data-i="'+i+'">'+
            '<div class="sl-left">'+
            '<div class="sl-name">/'+esc(s.name)+' '+badge+'</div>'+
            (s.desc?'<div class="sl-desc">'+esc(s.desc)+'</div>':'')+
            '</div></div>';
    });
    html+='</div>';
    $pop.html(html).addClass('show');

    $pop.find('.slash-row').on('mouseenter',function(){
        _slashIdx=$(this).data('i');
        $pop.find('.slash-row').removeClass('active');
        $(this).addClass('active');
    }).on('mousedown',function(e){
        e.preventDefault();
        pickSlashSkill(_slashFiltered[$(this).data('i')]);
    });
    scrollSlashActive();
}

function scrollSlashActive(){
    var $a=$('#slash-popup .slash-row.active');
    if($a.length) $a[0].scrollIntoView({block:'nearest',behavior:'smooth'});
}

function hideSlashPopup(){
    $('#slash-popup').removeClass('show');
    _slashIdx=-1;
    _slashFiltered=[];
    _slashFetched=false;
}

function isSlashOpen(){return $('#slash-popup').hasClass('show')}

function pickSlashSkill(skill){
    hideSlashPopup();
    selectedForcedSkill=skill.name;
    // 입력창에서 /xxx 제거
    var v=$('#msg-input').val().replace(/^\/\S*\s?/,'');
    $('#msg-input').val(v).focus();
    autoResize($('#msg-input')[0]);
    renderSkillMention();
}

function renderSkillMention(){
    $('#skill-mention').remove();
    if(!selectedForcedSkill) return;
    var $m=$('<div id="skill-mention"><span class="sm-icon">📚</span><span class="sm-name">'+esc(selectedForcedSkill)+'</span><span class="sm-x" title="스킬 해제">✕</span></div>');
    $m.find('.sm-x').on('click',function(){
        selectedForcedSkill=null;
        $('#skill-mention').remove();
        $('#msg-input').focus();
    });
    $('.input-wrap').before($m);
}

function handleSlashKey(e){
    if(!isSlashOpen()) return false;
    if(e.key==='ArrowDown'){
        e.preventDefault();
        _slashIdx=Math.min(_slashIdx+1,_slashFiltered.length-1);
        $('#slash-popup .slash-row').removeClass('active').eq(_slashIdx).addClass('active');
        scrollSlashActive();
        return true;
    }
    if(e.key==='ArrowUp'){
        e.preventDefault();
        _slashIdx=Math.max(_slashIdx-1,0);
        $('#slash-popup .slash-row').removeClass('active').eq(_slashIdx).addClass('active');
        scrollSlashActive();
        return true;
    }
    if(e.key==='Enter'||e.key==='Tab'){
        e.preventDefault();
        if(_slashIdx>=0&&_slashIdx<_slashFiltered.length) pickSlashSkill(_slashFiltered[_slashIdx]);
        return true;
    }
    if(e.key==='Escape'){
        e.preventDefault();
        hideSlashPopup();
        // 입력창의 /텍스트도 지움
        var v=$('#msg-input').val().replace(/^\/\S*$/,'');
        $('#msg-input').val(v);
        return true;
    }
    return false;
}

var _slashFetched=false; // 현재 슬래시 세션에서 이미 fetch했는지
function checkSlashTrigger(){
    var val=$('#msg-input').val();
    if(val.match(/^\/(\S*)$/)){
        var q=val.substring(1);
        if(!_slashFetched){
            // "/" 처음 입력 시 최신 목록 fetch
            _slashFetched=true;
            loadSlashSkills(function(){
                _slashIdx=0;
                showSlashPopup(q);
            });
        } else {
            // 이미 fetch한 상태에서 필터 타이핑 중
            _slashIdx=0;
            showSlashPopup(q);
        }
    } else {
        if(isSlashOpen()) hideSlashPopup();
        _slashFetched=false; // 슬래시 세션 종료
    }
}

// ================================================================
// Chat Logs (MongoDB) - 페이징 (초기 12건 + 더보기 10건씩)
// ================================================================
var INITIAL_PAGE=12, MORE_PAGE=10;
var chatLogState={skip:0,total:0,moreClicked:false};

function buildLogItem(sid, title, dt){
    var $it=$('<div class="log-item'+(sid===currentSessionId?' active':'')+'"></div>').data('sid',sid);
    $it.html('<div style="display:flex;align-items:center;gap:4px"><div class="log-title" style="flex:1" title="'+esc(title||'(제목 없음)')+'">'+esc(title||'(제목 없음)')+'</div><span class="log-del material-icons-outlined" title="삭제">close</span></div><div class="log-meta"><span>'+dt+'</span></div>');
    $it.on('click',function(e){
        if($(e.target).hasClass('log-del')){
            var _sid=$(this).data('sid'),_title=$(this).find('.log-title').text()||'(제목 없음)';
            showModal('🗑 대화 삭제','<p style="line-height:1.8"><b>'+esc(_title)+'</b></p><p style="color:var(--tx3);font-size:12px;margin-top:4px">이 대화를 삭제하시겠습니까?<br>삭제된 대화는 복구할 수 없습니다.</p>',[
                {label:'취소'},
                {label:'삭제',cls:'danger',action:function(){
                    $.ajax({url:apiUrl('/api/chat-log/'+_sid),type:'DELETE',success:function(){loadChatLogs(true)}});
                }}
            ]);
            return;
        }
        var s=$(this).data('sid');
        // 이미 선택된 세션이더라도 대화 내용이 표시되지 않은 상태면 로드 허용
        var hasMessages=$('#messages .msg').length>0;
        if(s===currentSessionId&&hasMessages)return;
        ws.send(JSON.stringify({type:'load_session',session_id:s}));$('.log-item').removeClass('active');$(this).addClass('active');currentSessionId=s;
    });
    return $it;
}

function prependNewChatLog(taskId){
    if(taskId){
        $.getJSON(apiUrl('/api/chat-logs'),{skip:0,limit:1},function(d){
            if(!d.logs||!d.logs.length)return;
            var log=d.logs[0];
            var $l=$('#log-list');
            $l.find('.log-empty').remove();
            $l.find('.log-item').each(function(){if($(this).data('sid')===log.session_id)$(this).remove()});
            var dt=log.updated_at?log.updated_at.substring(0,16).replace('T',' '):'';
            var $it=buildLogItem(log.session_id, log.title, dt);
            $it.hide().prependTo($l).slideDown(200);
            chatLogState.total=d.total||chatLogState.total;
            chatLogState.skip=Math.min(chatLogState.skip+1, chatLogState.total);
            currentSessionId=log.session_id;
            $l.find('.log-item').removeClass('active');
            $it.addClass('active');
            trimLogList($l);
        });
    } else {
        if(!lastSentMessage)return;
        var $l=$('#log-list');
        $l.find('.log-empty').remove();
        var now=new Date();var dt=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
        var title=lastSentMessage.substring(0,80)+(lastSentMessage.length>80?'...':'');
        var $it=buildLogItem(currentSessionId, title, dt);
        $it.hide().prependTo($l).slideDown(200);
        chatLogState.skip++;chatLogState.total++;
        $l.find('.log-item').removeClass('active');
        $it.addClass('active');
        trimLogList($l);
    }
}

function trimLogList($l){
    var $items=$l.find('.log-item');
    if(!chatLogState.moreClicked && $items.length>INITIAL_PAGE){
        $items.slice(INITIAL_PAGE).remove();
        chatLogState.skip=INITIAL_PAGE;
    }
    $l.find('.log-more-btn').remove();
    if(chatLogState.skip<chatLogState.total){
        var remaining=chatLogState.total-chatLogState.skip;
        var $more=$('<div class="log-more-btn"><span class="material-icons-outlined">expand_more</span> 더보기 <span class="log-count-badge">'+remaining+'건 남음</span></div>');
        $more.on('click',function(){
            chatLogState.moreClicked=true;
            $(this).html('<span class="material-icons-outlined" style="animation:tcSpin .7s linear infinite">refresh</span> 불러오는 중...');
            loadChatLogs(false);
        });
        $l.append($more);
    }
}

function loadChatLogs(reset){
    if(reset===true||chatLogState.skip===0){
        chatLogState.skip=0;
        chatLogState.total=0;
        chatLogState.moreClicked=false;
        $('#log-list').empty();
    }
    var limit=(chatLogState.skip===0)?INITIAL_PAGE:MORE_PAGE;
    $.getJSON(apiUrl('/api/chat-logs'),{skip:chatLogState.skip,limit:limit},function(d){
        chatLogState.total=d.total||0;
        var $l=$('#log-list');
        $l.find('.log-more-btn').remove();
        $l.find('.log-empty').remove();
        if(!d.logs||!d.logs.length){
            if(chatLogState.skip===0)$l.append('<div class="log-empty"><span class="material-icons-outlined">forum</span>대화 기록이 없습니다</div>');
            return;
        }
        $.each(d.logs,function(i,log){
            var dt=log.updated_at?log.updated_at.substring(0,16).replace('T',' '):'';
            $l.append(buildLogItem(log.session_id, log.title, dt));
        });
        chatLogState.skip+=d.logs.length;
        if(chatLogState.skip<chatLogState.total){
            var remaining=chatLogState.total-chatLogState.skip;
            var $more=$('<div class="log-more-btn"><span class="material-icons-outlined">expand_more</span> 더보기 <span class="log-count-badge">'+remaining+'건 남음</span></div>');
            $more.on('click',function(){
                chatLogState.moreClicked=true;
                $(this).html('<span class="material-icons-outlined" style="animation:tcSpin .7s linear infinite">refresh</span> 불러오는 중...');
                loadChatLogs(false);
            });
            $l.append($more);
        }
    }).fail(function(){});
}
function loadSessionMessages(msgs){
    var $m=$('#messages').empty();$('#welcome').hide();
    $.each(msgs,function(i,msg){
        var cls=msg.role==='user'?'user':'assistant';
        var $d=$('<div class="msg '+cls+'"><div class="msg-bubble"></div></div>');
        var content = msg.content || '';
        // content가 배열인 경우 (tool_use/tool_result 포함) 텍스트만 추출
        if(Array.isArray(content)){
            var texts = [];
            content.forEach(function(block){
                if(typeof block === 'string') texts.push(block);
                else if(block && block.type === 'text' && block.text) texts.push(block.text);
                else if(block && block.type === 'tool_use') texts.push('[🔧 ' + (block.name||'tool') + ']');
                else if(block && block.type === 'tool_result') texts.push('[✓ 결과]');
            });
            content = texts.join('\n');
        }
        if(cls==='user'){
            // 사용자 메시지: 줄바꿈 보존
            $d.find('.msg-bubble').html(esc(content).replace(/\n/g,'<br>'));
        } else {
            // AI 메시지: marked로 마크다운 파싱 (줄바꿈 포함)
            if(content){
                $d.find('.msg-bubble').html(marked.parse(content));
            }
        }
        $m.append($d);
    });
    scrollBottom();finishProcessing();
}

// ================================================================
// File Browser
// ================================================================
function refreshFiles(){
    var url=apiUrlO('/api/files')+(apiUrlO('/api/files').indexOf('?')>=0?'&':'?')+'path='+encodeURIComponent(currentPath);
    $.getJSON(url,function(d){renderFiles(d.items||[]);renderBreadcrumb();
        if(shareMode){
            $('#current-folder-display').text('📎 '+shareMode.owner+'/'+currentPath);
            // 읽기 전용이면 업로드/새폴더/전체삭제 비활성
            var ro=shareMode.perm==='read';
            $('#btn-upload,#btn-upload-folder,#btn-new-folder,#btn-delete-all').prop('disabled',ro).css('opacity',ro?.4:1);
        } else {
            $('#current-folder-display').text(currentPath==='.'?'루트':currentPath);
            $('#btn-upload,#btn-upload-folder,#btn-new-folder,#btn-delete-all').prop('disabled',false).css('opacity',1);
        }
    })
}
var selectedFiles=[];
function updateMoveBar(){
    var $bar=$('#move-bar');
    if(selectedFiles.length>0){$bar.addClass('show').find('.move-count').text(selectedFiles.length)}
    else{$bar.removeClass('show')}
}
function toggleSelect(fp,$fi){
    var idx=selectedFiles.indexOf(fp);
    if(idx>=0){selectedFiles.splice(idx,1);$fi.removeClass('selected')}
    else{selectedFiles.push(fp);$fi.addClass('selected')}
    updateMoveBar();
}
function moveItems(items,destFolder){
    $.ajax({url:apiUrl('/api/move'),type:'POST',contentType:'application/json',
        data:JSON.stringify({items:items,destFolder:destFolder,owner:shareMode?shareMode.owner:undefined}),
        success:function(r){
            selectedFiles=[];updateMoveBar();refreshFiles();
            if(r.errors&&r.errors.length){showModal('⚠️ 이동 결과',(r.moved.length?r.moved.length+'개 이동 완료<br>':'')+'오류: '+r.errors.map(function(e){return esc(e.path)+' - '+esc(e.error)}).join('<br>'),[{label:'확인',cls:'primary'}])}
        },
        error:function(x){showModal('❌ 오류',esc(x.responseJSON?.detail||'이동 실패'),[{label:'확인'}])}
    });
}
function renderFiles(items){
    var $l=$('#file-list').empty();if(!items.length){$l.append('<div class="fi-empty">비어 있음</div>');return}
    items.sort(function(a,b){if(a.type===b.type)return a.name.localeCompare(b.name);return a.type==='directory'?-1:1});
    $.each(items,function(i,it){
        var icon,cls;if(it.type==='directory'){icon='📁';cls='fi dir'}else{var ext=it.name.split('.').pop().toLowerCase();icon=FILE_ICONS[ext]||'📄';cls='fi file'}
        var fp=currentPath==='.'?it.name:currentPath+'/'+it.name;
        var $fi=$('<div class="'+cls+'" draggable="true"></div>');
        $fi.data('fp',fp).data('it',it);
        // 선택 상태 복원
        if(selectedFiles.indexOf(fp)>=0)$fi.addClass('selected');
        $fi.append('<span class="fi-icon">'+icon+'</span>');
        var $nm=$('<span class="fi-name" title="'+esc(it.name)+'">'+esc(it.name)+'</span>').data('it',it).data('fp',fp);
        $nm.on('click',function(e){
            e.stopPropagation();
            if(e.ctrlKey||e.metaKey){toggleSelect(fp,$fi);return}
            var x=$(this).data('it'),p=$(this).data('fp');
            if(x.type==='directory'){currentPath=p;refreshFiles()}
            else{showModal('📄 '+esc(x.name),'채팅에서 확인하시겠습니까?',[{label:'취소'},{label:'확인',cls:'primary',action:function(){$('#msg-input').val(p+' 파일 내용을 보여줘');sendMessage()}}])}
        });
        $fi.append($nm).append('<span class="fi-size">'+(it.type==='directory'?(it.child_count!=null?(it.child_count>0?it.child_count+'개 항목':'비어 있음'):''):(it.size!=null?fmtSize(it.size):''))+'</span>');
        var $a=$('<span class="fi-actions"></span>');
        if(it.type==='directory'){$('<button class="fi-act dl" title="zip">📦</button>').data('p',fp).on('click',function(e){e.stopPropagation();window.location.href=apiUrlO('/api/download-folder?path='+encodeURIComponent($(this).data('p')))}).appendTo($a);
            $('<button class="fi-act" title="공유" style="font-size:12px">🔗</button>').data('p',fp).data('n',it.name).on('click',function(e){e.stopPropagation();showShareModal($(this).data('p'),$(this).data('n'))}).appendTo($a)}
        else{$('<button class="fi-act dl" title="다운로드">⬇</button>').data('p',fp).on('click',function(e){e.stopPropagation();window.location.href=apiUrlO('/api/download?path='+encodeURIComponent($(this).data('p')))}).appendTo($a);
            var ext=it.name.split('.').pop().toLowerCase();
            if(/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env|gitignore|htaccess|png|jpg|jpeg|gif|webp|bmp|ico)$/.test(ext)){
                $('<button class="fi-act preview" title="미리보기">👁</button>').data('p',fp).on('click',function(e){e.stopPropagation();window.open(previewUrl($(this).data('p')),'_blank')}).appendTo($a)
            }
            if(/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env)$/.test(ext)){
                $('<button class="fi-act" title="편집" style="color:#50fa7b;font-size:12px">✏️</button>').data('p',fp).on('click',function(e){e.stopPropagation();window.open(previewUrl($(this).data('p'))+(previewUrl($(this).data('p')).indexOf('?')>-1?'&':'?')+'edit=1','_blank')}).appendTo($a)
            }
            if(/^(pptx?|xlsx?|docx?|pdf|hwp|hwpx|cell|show|txt|csv)$/.test(ext)){
                $('<button class="fi-act preview" title="문서 뷰어" style="color:var(--blue)">📄</button>').data('p',fp).on('click',function(e){e.stopPropagation();openOfficeViewer($(this).data('p'))}).appendTo($a)
            }
        }
        $('<button class="fi-act ren" title="이름 변경">✏</button>').data('p',fp).data('n',it.name).on('click',function(e){e.stopPropagation();renameItem($(this).data('p'),$(this).data('n'))}).appendTo($a);
        $('<button class="fi-act del" title="삭제">✕</button>').data('p',fp).data('n',it.name).on('click',function(e){e.stopPropagation();var p=$(this).data('p'),n=$(this).data('n');showModal('삭제','<code>'+esc(n)+'</code> 삭제?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){$.ajax({url:apiUrlO('/api/file?path='+encodeURIComponent(p)),type:'DELETE',success:refreshFiles})}}])}).appendTo($a);
        $fi.append($a);

        // 드래그 시작
        $fi.on('dragstart',function(e){
            var dragFp=$(this).data('fp');
            // 선택된 항목이 없거나 드래그 대상이 선택에 없으면 단일 드래그
            var dragItems;
            if(selectedFiles.length>0 && selectedFiles.indexOf(dragFp)>=0){dragItems=selectedFiles.slice()}
            else{dragItems=[dragFp]}
            e.originalEvent.dataTransfer.setData('application/json',JSON.stringify(dragItems));
            e.originalEvent.dataTransfer.effectAllowed='move';
            $(this).addClass('dragging');
        });
        $fi.on('dragend',function(){$(this).removeClass('dragging')});

        // 폴더에 드롭 가능
        if(it.type==='directory'){
            $fi.on('dragover',function(e){e.preventDefault();e.originalEvent.dataTransfer.dropEffect='move';$(this).addClass('drag-over')});
            $fi.on('dragleave',function(){$(this).removeClass('drag-over')});
            $fi.on('drop',function(e){
                e.preventDefault();$(this).removeClass('drag-over');
                var raw=e.originalEvent.dataTransfer.getData('application/json');
                if(!raw)return;
                var dragItems=JSON.parse(raw);
                var destFp=$(this).data('fp');
                // 자기 자신으로 이동 방지
                dragItems=dragItems.filter(function(d){return d!==destFp});
                if(dragItems.length)moveItems(dragItems,destFp);
            });
        }
        $l.append($fi)});
    updateMoveBar();
}
function renderBreadcrumb(){
    var $b=$('#breadcrumb').empty();
    if(shareMode){
        $('<span class="bc-link" style="background:var(--blue);color:#fff;border-radius:4px;padding:1px 6px;cursor:pointer" title="공유 모드 나가기">✕</span>').on('click',exitShareMode).appendTo($b);
        $b.append(' ');
        $b.append('<span style="color:var(--blue);font-weight:600">📎 '+esc(shareMode.owner)+'</span> / ');
        var rootName=shareMode.rootPath.split('/').pop()||shareMode.rootPath;
        $('<span class="bc-link">'+esc(rootName)+'</span>').on('click',function(){currentPath=shareMode.rootPath;refreshFiles()}).appendTo($b);
        // 공유 루트 이후의 하위 경로 표시
        var rel=currentPath;
        if(rel.startsWith(shareMode.rootPath+'/')){rel=rel.substring(shareMode.rootPath.length+1)}
        else if(rel===shareMode.rootPath){rel=''}
        if(rel){
            var parts=rel.split('/').filter(Boolean),acc=shareMode.rootPath;
            $.each(parts,function(i,p){acc+='/'+p;$b.append(' / ');var pp=acc;
                $('<span class="bc-link">'+esc(p)+'</span>').on('click',function(){currentPath=pp;refreshFiles()}).appendTo($b)});
        }
    } else {
        var $home=$('<span class="bc-link">Home</span>').on('click',function(){currentPath='.';refreshFiles()});
        $home.on('dragover',function(e){e.preventDefault();$(this).addClass('drag-over')})
             .on('dragleave',function(){$(this).removeClass('drag-over')})
             .on('drop',function(e){e.preventDefault();$(this).removeClass('drag-over');
                 var raw=e.originalEvent.dataTransfer.getData('application/json');if(!raw)return;
                 var items=JSON.parse(raw);if(items.length)moveItems(items,'.');
             });
        $b.append($home);
        if(currentPath==='.')return;var parts=currentPath.split('/').filter(Boolean),acc='';
        $.each(parts,function(i,p){acc+=(acc?'/':'')+p;$b.append(' / ');var pp=acc;
            var $link=$('<span class="bc-link">'+p+'</span>').on('click',function(){currentPath=pp;refreshFiles()});
            $link.on('dragover',function(e){e.preventDefault();$(this).addClass('drag-over')})
                 .on('dragleave',function(){$(this).removeClass('drag-over')})
                 .on('drop',function(e){e.preventDefault();$(this).removeClass('drag-over');
                     var raw=e.originalEvent.dataTransfer.getData('application/json');if(!raw)return;
                     var items=JSON.parse(raw);if(items.length)moveItems(items,pp);
                 });
            $b.append($link)});
    }
}
function renameItem(path,oldName){
    var ext='';var base=oldName;var dot=oldName.lastIndexOf('.');
    if(dot>0){ext=oldName.substring(dot);base=oldName.substring(0,dot)}
    showModal('이름 변경','<div style="margin-bottom:8px;font-size:12px;color:var(--tx2)"><code>'+esc(oldName)+'</code></div><input type="text" class="modal-input" id="rename-input" value="'+esc(oldName)+'" autofocus>',[{label:'취소'},{label:'변경',cls:'primary',action:function(){
        var nn=$.trim($('#rename-input').val());
        if(!nn||nn===oldName)return;
        $.ajax({url:apiUrl('/api/rename'),type:'POST',contentType:'application/json',data:JSON.stringify({path:path,newName:nn,owner:shareMode?shareMode.owner:undefined}),success:refreshFiles,error:function(x){showModal('❌ 오류',esc(x.responseJSON?.detail||'이름 변경 실패'),[{label:'확인'}])}})
    }}]);
    setTimeout(function(){
        var $inp=$('#rename-input');$inp.focus();
        if(ext&&$inp.val().endsWith(ext)){$inp[0].setSelectionRange(0,base.length)}
        $inp.on('keydown',function(e){if(e.key==='Enter'){e.preventDefault();$('.modal-btn.primary').click()}})
    },100)
}
function createFolder(){showModal('새 폴더','<input type="text" class="modal-input" id="nf-name" placeholder="폴더 이름" autofocus>',[{label:'취소'},{label:'생성',cls:'primary',action:function(){var n=$.trim($('#nf-name').val());if(!n)return;$.ajax({url:apiUrl('/api/create-folder'),type:'POST',contentType:'application/json',data:JSON.stringify({path:currentPath,name:n,owner:shareMode?shareMode.owner:undefined}),success:refreshFiles,error:function(x){alert(x.responseJSON?.detail||'오류')}})}}]);setTimeout(function(){$('#nf-name').focus().on('keydown',function(e){if(e.key==='Enter'){e.preventDefault();$('.modal-btn.primary').click()}})},100)}
function deleteAllFiles(){showModal('전체 삭제','현재 폴더의 모든 항목을 삭제하시겠습니까?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){$.ajax({url:apiUrl('/api/delete-all'),type:'POST',contentType:'application/json',data:JSON.stringify({path:currentPath,owner:shareMode?shareMode.owner:undefined}),success:refreshFiles})}}])}
function uploadFiles(files){var t=files.length,d=0;$.each(files,function(i,f){var fd=new FormData();fd.append('file',f);fd.append('path',currentPath);if(shareMode)fd.append('owner',shareMode.owner);$.ajax({url:apiUrl('/api/upload'),type:'POST',data:fd,processData:false,contentType:false,complete:function(){d++;if(d>=t)refreshFiles()}})})}
function uploadFolder(files){
    if(!files.length)return;
    var total=files.length, batchSize=20, uploaded=0, failed=0;
    var batches=[];
    for(var i=0;i<total;i+=batchSize){
        batches.push(Array.prototype.slice.call(files,i,i+batchSize));
    }
    // 진행률 모달 표시
    showModal('📤 폴더 업로드','<div id="upload-prog-wrap"><div style="font-size:13px;margin-bottom:8px">0 / '+total+' 파일 업로드 중...</div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div id="upload-prog-bar" style="width:0%;height:100%;background:var(--blue);transition:width .3s"></div></div><div id="upload-prog-detail" style="font-size:11px;color:#888;margin-top:6px"></div></div>',[]);
    var ownerParam=shareMode?shareMode.owner:null;
    function sendBatch(idx){
        if(idx>=batches.length){
            refreshFiles();
            showModal('✅ 업로드 완료','총 '+uploaded+'개 파일 업로드'+(failed>0?' ('+failed+'개 실패)':''),[{label:'확인',cls:'primary'}]);
            return;
        }
        var batch=batches[idx];
        var fd=new FormData();
        for(var j=0;j<batch.length;j++) fd.append('files',batch[j],batch[j].webkitRelativePath||batch[j].name);
        fd.append('basePath',currentPath);
        if(ownerParam) fd.append('owner',ownerParam);
        $.ajax({url:apiUrl('/api/upload-folder'),type:'POST',data:fd,processData:false,contentType:false,
            success:function(r){
                uploaded+=(r.count||batch.length);
                var pct=Math.round(uploaded/total*100);
                $('#upload-prog-bar').css('width',pct+'%');
                $('#upload-prog-wrap div:first').text(uploaded+' / '+total+' 파일 업로드 중...');
                $('#upload-prog-detail').text('배치 '+(idx+1)+'/'+batches.length+' 완료');
                sendBatch(idx+1);
            },
            error:function(){
                failed+=batch.length;
                uploaded+=batch.length;
                var pct=Math.round(uploaded/total*100);
                $('#upload-prog-bar').css('width',pct+'%');
                sendBatch(idx+1);
            }
        });
    }
    sendBatch(0);
}

// ============ 공유 폴더 기능 ============
var currentRpTab='files';
function switchRpTab(tab){
    currentRpTab=tab;
    $('.rp-tabs .rp-tab').removeClass('active');
    $('.rp-tabs .rp-tab[data-rptab="'+tab+'"]').addClass('active');
    if(tab==='files'){
        if(shareMode){shareMode=null;currentPath='.';}
        $('#rp-files-view').show();$('#rp-shared-view').hide();$('.rp-bottom').show();
        refreshFiles();
    } else {
        if(shareMode){shareMode=null;currentPath='.';}
        $('#rp-files-view').hide();$('#rp-shared-view').show();$('.rp-bottom').hide();
        $('#shared-browse').hide();$('#shared-received,#shared-mine').show();
        loadShares();
    }
}
function showShareModal(folderPath,folderName){
    var picker=UserPicker({containerId:'folder-share-picker',placeholder:'이름 또는 부서로 검색',multi:true});
    var html=
        '<div style="margin-bottom:10px;font-size:12px">📁 <code>'+esc(folderName)+'</code></div>'+
        picker.html+
        '<div style="margin-top:10px"><label style="font-size:11px;color:var(--tx2);display:flex;align-items:center;gap:6px"><input type="checkbox" id="share-write"> 쓰기 권한 부여</label></div>';
    showModal('🔗 폴더 공유',html,[
        {label:'취소'},
        {label:'공유',cls:'primary',action:function(){
            var sel=picker.getSelected();
            if(!sel.length){alert('공유할 사용자를 선택해주세요');return}
            var perm=$('#share-write').is(':checked')?'write':'read';
            var lids=sel.map(function(u){return u.lid});
            $.ajax({url:apiUrl('/api/share'),type:'POST',contentType:'application/json',
                data:JSON.stringify({path:folderPath,targetUsers:lids,permission:perm}),
                success:function(r){
                    showModal('✅ 공유 완료',esc(r.message),[{label:'확인',cls:'primary'}]);
                },
                error:function(x){showModal('❌ 오류',esc(x.responseJSON?.detail||'공유 실패'),[{label:'확인'}])}
            });
        }}
    ]);
    picker.init();
}
function loadShares(){
    // 공유 받은 폴더
    $.getJSON(apiUrl('/api/shares/received'),function(d){
        var $l=$('#shared-received-list').empty();
        if(!d.shares||!d.shares.length){$l.append('<div class="share-empty">공유 받은 폴더가 없습니다</div>');return}
        $.each(d.shares,function(i,s){
            var $it=$('<div class="share-item"></div>');
            $it.append('<span class="si-icon">📁</span>');
            var $info=$('<div class="si-info"></div>');
            $info.append('<div class="si-name" title="'+esc(s.folder_name||s.folder_path)+'">'+esc(s.folder_name||s.folder_path)+'</div>');
            $info.append('<div class="si-meta">from <b>'+esc(s.owner)+'</b> <span class="share-perm '+s.permission+'">'+s.permission+'</span></div>');
            $it.append($info);
            var $acts=$('<div class="si-actions"></div>');
            $('<button class="si-btn" title="열기">📂</button>').data('s',s).on('click',function(e){
                e.stopPropagation();var sh=$(this).data('s');browseSharedFolder(sh.owner,sh.folder_path,sh.folder_name,sh.permission);
            }).appendTo($acts);
            $('<button class="si-btn" title="내 폴더로 복사">📋</button>').data('s',s).on('click',function(e){
                e.stopPropagation();var sh=$(this).data('s');
                copySharedToMine(sh.owner,sh.folder_path);
            }).appendTo($acts);
            $('<button class="si-btn danger" title="공유 해제">✕</button>').data('id',s.id).on('click',function(e){
                e.stopPropagation();var sid=$(this).data('id');
                showModal('공유 해제','이 공유를 해제하시겠습니까?',[{label:'취소'},{label:'해제',cls:'danger',action:function(){
                    $.ajax({url:apiUrl('/api/share?share_id='+sid),type:'DELETE',success:loadShares});
                }}]);
            }).appendTo($acts);
            $it.append($acts);$l.append($it);
        });
    });
    // 내가 공유한 폴더
    $.getJSON(apiUrl('/api/shares/my'),function(d){
        var $l=$('#shared-mine-list').empty();
        if(!d.shares||!d.shares.length){$l.append('<div class="share-empty">공유한 폴더가 없습니다</div>');return}
        $.each(d.shares,function(i,s){
            var $it=$('<div class="share-item"></div>');
            $it.append('<span class="si-icon">📤</span>');
            var $info=$('<div class="si-info"></div>');
            $info.append('<div class="si-name" title="'+esc(s.folder_name||s.folder_path)+'">'+esc(s.folder_name||s.folder_path)+'</div>');
            $info.append('<div class="si-meta">→ <b>'+esc(s.shared_with)+'</b> <span class="share-perm '+s.permission+'">'+s.permission+'</span></div>');
            $it.append($info);
            var $acts=$('<div class="si-actions"></div>');
            $('<button class="si-btn danger" title="공유 해제">✕</button>').data('id',s.id).on('click',function(e){
                e.stopPropagation();var sid=$(this).data('id');
                showModal('공유 해제','이 공유를 해제하시겠습니까?',[{label:'취소'},{label:'해제',cls:'danger',action:function(){
                    $.ajax({url:apiUrl('/api/share?share_id='+sid),type:'DELETE',success:loadShares});
                }}]);
            }).appendTo($acts);
            $it.append($acts);$l.append($it);
        });
    });
}
var sharedBrowseOwner='',sharedBrowseRoot='',sharedBrowsePath='',sharedBrowsePerm='';
function browseSharedFolder(owner,rootPath,folderName,perm){
    // 공유 모드 진입: 파일 목록 뷰를 보여주되, 공유 탭 활성 상태 유지
    shareMode={owner:owner,rootPath:rootPath,perm:perm};
    currentPath=rootPath;
    // 파일 목록 뷰 표시 (탭은 공유 유지)
    $('#rp-files-view').show();$('#rp-shared-view').hide();$('.rp-bottom').show();
    $('.rp-tabs .rp-tab').removeClass('active');
    $('#rptab-shared').addClass('active');
    currentRpTab='shared';
    refreshFiles();
}
function exitShareMode(){
    shareMode=null;
    currentPath='.';
    switchRpTab('files');
}
function loadSharedFiles(){
    $.getJSON(apiUrl('/api/shares/files'),{owner:sharedBrowseOwner,path:sharedBrowsePath},function(d){
        renderSharedBreadcrumb();
        var $l=$('#shared-file-list').empty();
        var items=d.items||[];
        if(!items.length){$l.append('<div class="fi-empty">비어 있음</div>');return}
        items.sort(function(a,b){if(a.type===b.type)return a.name.localeCompare(b.name);return a.type==='directory'?-1:1});
        $.each(items,function(i,it){
            var icon;if(it.type==='directory'){icon='📁'}else{var ext=it.name.split('.').pop().toLowerCase();icon=FILE_ICONS[ext]||'📄'}
            var fp=sharedBrowsePath==='.'?it.name:sharedBrowsePath+'/'+it.name;
            var $fi=$('<div class="shared-file-item"></div>');
            $fi.append('<span class="fi-icon">'+icon+'</span>');
            var $nm=$('<span class="fi-name" title="'+esc(it.name)+'">'+esc(it.name)+'</span>');
            if(it.type==='directory'){
                $nm.data('fp',fp).on('click',function(){sharedBrowsePath=$(this).data('fp');loadSharedFiles()});
            }
            $fi.append($nm);
            $fi.append('<span class="fi-size">'+(it.size!=null?fmtSize(it.size):'')+'</span>');
            var $a=$('<span class="fi-actions"></span>');
            $('<button class="fi-act" title="내 폴더로 복사" style="font-size:11px">📋</button>').data('fp',fp).on('click',function(e){
                e.stopPropagation();copySharedToMine(sharedBrowseOwner,$(this).data('fp'));
            }).appendTo($a);
            $fi.append($a);$l.append($fi);
        });
    });
}
function renderSharedBreadcrumb(){
    var $b=$('#shared-breadcrumb').empty();
    $('<span class="bc-link" style="cursor:pointer">← 공유 목록</span>').on('click',function(){
        $('#shared-browse').hide();$('#shared-received,#shared-mine').show();
    }).appendTo($b);
    $b.append(' / ');
    $('<span class="bc-link">'+esc(sharedBrowseOwner)+'</span>').appendTo($b);
    // 공유 루트 이후의 하위 경로 표시
    var rel=sharedBrowsePath;
    if(rel.startsWith(sharedBrowseRoot)){rel=rel.substring(sharedBrowseRoot.length);if(rel.startsWith('/'))rel=rel.substring(1)}
    var rootName=sharedBrowseRoot.split('/').pop()||sharedBrowseRoot;
    $b.append(' / ');
    $('<span class="bc-link">'+esc(rootName)+'</span>').on('click',function(){sharedBrowsePath=sharedBrowseRoot;loadSharedFiles()}).appendTo($b);
    if(rel){
        var parts=rel.split('/').filter(Boolean),acc=sharedBrowseRoot;
        $.each(parts,function(i,p){acc+='/'+p;$b.append(' / ');var pp=acc;
            $('<span class="bc-link">'+esc(p)+'</span>').on('click',function(){sharedBrowsePath=pp;loadSharedFiles()}).appendTo($b)});
    }
}
function copySharedToMine(owner,srcPath){
    showModal('📋 내 폴더로 복사','<code>'+esc(srcPath.split('/').pop())+'</code>을(를) 현재 작업 폴더로 복사하시겠습니까?',[
        {label:'취소'},
        {label:'복사',cls:'primary',action:function(){
            $.ajax({url:apiUrl('/api/shares/copy'),type:'POST',contentType:'application/json',
                data:JSON.stringify({owner:owner,srcPath:srcPath,destPath:currentPath}),
                success:function(r){refreshFiles();showModal('✅ 복사 완료',esc(r.copied)+' → '+esc(r.dest),[{label:'확인',cls:'primary'}])},
                error:function(x){showModal('❌ 오류',esc(x.responseJSON?.detail||'복사 실패'),[{label:'확인'}])}
            });
        }}
    ]);
}
// ============ 인포그래픽 생성 ============
function showInfographicModal(){
    var html=
        '<div style="font-size:12px;color:var(--tx2);margin-bottom:12px">작업 폴더의 파일 또는 주제를 기반으로 인포그래픽을 생성합니다.</div>'+
        '<div class="studio-form">'+
        '<label class="sf-label">소스 지정</label>'+
        '<div class="sf-row">'+
        '<select id="ig-source" class="sf-select"><option value="topic">주제/텍스트 입력</option><option value="folder">현재 작업 폴더 파일</option><option value="file">특정 파일 지정</option></select>'+
        '</div>'+
        '<div id="ig-source-topic"><label class="sf-label">주제 또는 내용</label><textarea id="ig-topic" class="sf-textarea" rows="3" placeholder="예: 2025년 AI 트렌드, 프로젝트 현황 요약..."></textarea></div>'+
        '<div id="ig-source-file" style="display:none"><label class="sf-label">파일 경로</label><input type="text" id="ig-file" class="sf-input" placeholder="예: reports/analysis.md"></div>'+
        '<label class="sf-label">레이아웃</label>'+
        '<div class="sf-row">'+
        '<label class="sf-radio"><input type="radio" name="ig-layout" value="horizontal" checked><span>가로 (16:9)</span></label>'+
        '<label class="sf-radio"><input type="radio" name="ig-layout" value="vertical"><span>세로 (9:16)</span></label>'+
        '<label class="sf-radio"><input type="radio" name="ig-layout" value="square"><span>정사각 (1:1)</span></label>'+
        '</div>'+
        '<label class="sf-label">스타일</label>'+
        '<div class="sf-row">'+
        '<select id="ig-style" class="sf-select">'+
        '<option value="modern">모던 미니멀</option>'+
        '<option value="corporate">비즈니스/기업</option>'+
        '<option value="colorful">컬러풀/활기찬</option>'+
        '<option value="dark">다크 테마</option>'+
        '<option value="infographic">데이터 시각화</option>'+
        '<option value="timeline">타임라인</option>'+
        '<option value="comparison">비교 분석</option>'+
        '<option value="flowchart">순서도/프로세스</option>'+
        '</select>'+
        '</div>'+
        '<label class="sf-label">출력 언어</label>'+
        '<div class="sf-row">'+
        '<select id="ig-lang" class="sf-select"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select>'+
        '</div>'+
        '<label class="sf-label">추가 지시사항 (선택)</label>'+
        '<input type="text" id="ig-custom" class="sf-input" placeholder="예: 아이콘을 많이 사용, 통계 강조...">'+
        '</div>';
    showModal('📊 인포그래픽 생성', html, [
        {label:'취소'},
        {label:'생성',cls:'primary',action:function(){
            var source=$('#ig-source').val();
            var layout=$('input[name="ig-layout"]:checked').val();
            var style=$('#ig-style').val();
            var lang=$('#ig-lang').val();
            var custom=$.trim($('#ig-custom').val());
            var prompt='';
            if(source==='topic'){
                var topic=$.trim($('#ig-topic').val());
                if(!topic){alert('주제 또는 내용을 입력해주세요');return}
                prompt='다음 주제로 인포그래픽을 생성해주세요.\n\n주제: '+topic;
            } else if(source==='folder'){
                prompt='현재 작업 폴더의 파일들을 분석하여 내용을 종합한 인포그래픽을 생성해주세요. 먼저 list_files로 파일 목록을 확인하고, 주요 파일들을 read_file로 읽어서 핵심 내용을 파악하세요.';
            } else {
                var file=$.trim($('#ig-file').val());
                if(!file){alert('파일 경로를 입력해주세요');return}
                prompt='다음 파일의 내용을 분석하여 인포그래픽을 생성해주세요. 먼저 read_file로 파일을 읽고 핵심 내용을 파악하세요.\n\n파일: '+file;
            }
            prompt+='\n\n[인포그래픽 설정]\n';
            prompt+='- 레이아웃: '+(layout==='horizontal'?'가로형 (16:9)':layout==='vertical'?'세로형 (9:16)':'정사각형 (1:1)')+'\n';
            prompt+='- 스타일: '+$('#ig-style option:selected').text()+'\n';
            prompt+='- 출력 언어: '+$('#ig-lang option:selected').text()+'\n';
            if(custom) prompt+='- 추가 지시: '+custom+'\n';
            prompt+='\n[생성 규칙]\n';
            prompt+='1. HTML+CSS 단일 파일로 생성 (write_file 사용)\n';
            prompt+='2. 파일명: infographic_[주제요약].html\n';
            prompt+='3. 인라인 SVG 아이콘과 CSS 그래디언트를 활용한 시각적 디자인\n';
            prompt+='4. 정보 계층구조: 핵심 숫자/통계를 크게, 설명을 작게\n';
            prompt+='5. 섹션별 아이콘/그래픽 요소 포함\n';
            prompt+='6. 반응형 디자인 + 인쇄/PNG 변환에 적합한 고정 사이즈 래퍼\n';
            prompt+='7. 전문 디자이너 수준의 타이포그래피, 색상 팔레트, 여백 사용\n';
            prompt+='8. Chart.js나 inline SVG로 데이터 차트/그래프 포함 (데이터가 있는 경우)\n';
            prompt+='9. 상단 제목, 중간 핵심 콘텐츠, 하단 출처/요약 구조\n';
            prompt+='10. Google Fonts CDN (Noto Sans KR 등) 활용\n';
            $('#msg-input').val(prompt);
            sendMessage();
        }}
    ]);
    setTimeout(function(){
        $('#ig-source').on('change',function(){
            var v=$(this).val();
            $('#ig-source-topic').toggle(v==='topic');
            $('#ig-source-file').toggle(v==='file');
        });
        $('#ig-topic').focus();
    },100);
}

// ============ 슬라이드 덱 생성 ============
function showSlideDeckModal(){
    var html=
        '<div class="studio-form">'+
        '<label class="sf-label">생성 방식</label>'+
        '<div class="sf-row">'+
        '<label class="sf-radio"><input type="radio" name="sd-mode" value="scratch" checked><span>새로 만들기</span></label>'+
        '<label class="sf-radio"><input type="radio" name="sd-mode" value="template"><span>📐 PPT 템플릿 활용</span></label>'+
        '</div>'+
        // === 공통: 소스 지정 ===
        '<label class="sf-label">콘텐츠 소스</label>'+
        '<div class="sf-row">'+
        '<select id="sd-source" class="sf-select"><option value="topic">주제/텍스트 입력</option><option value="folder">현재 작업 폴더 파일</option><option value="file">특정 파일 지정</option><option value="web">웹 검색</option></select>'+
        '</div>'+
        '<div id="sd-source-topic"><label class="sf-label">주제 또는 내용</label><textarea id="sd-topic" class="sf-textarea" rows="3" placeholder="예: 2025년 사업계획 발표, AI 도입 전략..."></textarea></div>'+
        '<div id="sd-source-file" style="display:none"><label class="sf-label">파일 경로</label><input type="text" id="sd-file" class="sf-input" placeholder="예: reports/plan.md"></div>'+
        '<div id="sd-source-web" style="display:none"><label class="sf-label">검색 키워드</label><input type="text" id="sd-web-query" class="sf-input" placeholder="예: 2025 AI 시장 전망"></div>'+
        // === 템플릿 모드 전용 ===
        '<div id="sd-template-section" style="display:none">'+
        '<label class="sf-label">템플릿 파일 (.pptx)</label>'+
        '<input type="text" id="sd-tpl-file" class="sf-input" placeholder="예: templates/company_template.pptx">'+
        '<div style="font-size:10px;color:var(--txh);margin-top:4px">작업 폴더 내 .pptx 파일 경로를 입력하세요</div>'+
        '<label class="sf-label">슬라이드 구성 방식</label>'+
        '<div class="sf-row">'+
        '<select id="sd-tpl-compose" class="sf-select">'+
        '<option value="auto">자동 구성 (내용에 맞는 레이아웃 자동 선택)</option>'+
        '<option value="full">전체 활용 (모든 레이아웃 유형 활용)</option>'+
        '<option value="selective">선택 활용 (분석 후 적합한 것만 선택)</option>'+
        '</select>'+
        '</div>'+
        '</div>'+
        // === 새로 만들기 전용 ===
        '<div id="sd-scratch-section">'+
        '<label class="sf-label">출력 형식</label>'+
        '<div class="sf-row">'+
        '<label class="sf-radio"><input type="radio" name="sd-format" value="pptx" checked><span>PPTX (파워포인트)</span></label>'+
        '<label class="sf-radio"><input type="radio" name="sd-format" value="html"><span>HTML (웹 슬라이드)</span></label>'+
        '</div>'+
        '<label class="sf-label">디자인 테마</label>'+
        '<div class="sf-row">'+
        '<select id="sd-theme" class="sf-select">'+
        '<option value="professional">프로페셔널 (파랑/네이비)</option>'+
        '<option value="modern">모던 미니멀 (흑백)</option>'+
        '<option value="creative">크리에이티브 (다채로운 색상)</option>'+
        '<option value="corporate">기업 브랜드 (깔끔한)</option>'+
        '<option value="warm">따뜻한 (오렌지/브라운)</option>'+
        '<option value="nature">자연/친환경 (그린)</option>'+
        '</select>'+
        '</div>'+
        '</div>'+
        // === 공통 설정 ===
        '<label class="sf-label">대상 청중</label>'+
        '<div class="sf-row">'+
        '<select id="sd-audience" class="sf-select">'+
        '<option value="general">일반</option>'+
        '<option value="executive">경영진/임원</option>'+
        '<option value="technical">기술팀/개발자</option>'+
        '<option value="investor">투자자</option>'+
        '<option value="student">학생/교육</option>'+
        '<option value="client">고객/클라이언트</option>'+
        '</select>'+
        '</div>'+
        '<label class="sf-label">슬라이드 수</label>'+
        '<div class="sf-row">'+
        '<select id="sd-count" class="sf-select">'+
        '<option value="5">5장 (간략)</option>'+
        '<option value="10" selected>10장 (표준)</option>'+
        '<option value="15">15장 (상세)</option>'+
        '<option value="20">20장 (종합)</option>'+
        '</select>'+
        '</div>'+
        '<label class="sf-label">출력 언어</label>'+
        '<div class="sf-row">'+
        '<select id="sd-lang" class="sf-select"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select>'+
        '</div>'+
        '<label class="sf-label">추가 지시사항 (선택)</label>'+
        '<input type="text" id="sd-custom" class="sf-input" placeholder="예: 발표자 노트 포함, 각 슬라이드에 핵심 통계...">'+
        '</div>';
    showModal('📑 슬라이드 덱 생성', html, [
        {label:'취소'},
        {label:'생성',cls:'primary',action:function(){
            var mode=$('input[name="sd-mode"]:checked').val();
            var source=$('#sd-source').val();
            var audience=$('#sd-audience option:selected').text();
            var count=$('#sd-count').val();
            var lang=$('#sd-lang option:selected').text();
            var custom=$.trim($('#sd-custom').val());
            var prompt='';

            // === 콘텐츠 소스 프롬프트 ===
            if(source==='topic'){
                var topic=$.trim($('#sd-topic').val());
                if(!topic){alert('주제 또는 내용을 입력해주세요');return}
                prompt='다음 주제로 프레젠테이션 슬라이드를 생성해주세요.\n\n주제: '+topic;
            } else if(source==='folder'){
                prompt='현재 작업 폴더의 파일들을 분석하여 내용을 종합한 프레젠테이션을 생성해주세요. 먼저 list_files로 파일 목록을 확인하고, 주요 파일들을 read_file로 읽어서 핵심 내용을 파악하세요.';
            } else if(source==='web'){
                var wq=$.trim($('#sd-web-query').val());
                if(!wq){alert('검색 키워드를 입력해주세요');return}
                prompt='다음 키워드로 웹 검색(web_search)하여 최신 정보를 수집한 후, 그 내용으로 프레젠테이션을 생성해주세요.\n\n검색 키워드: '+wq;
            } else {
                var file=$.trim($('#sd-file').val());
                if(!file){alert('파일 경로를 입력해주세요');return}
                prompt='다음 파일의 내용을 분석하여 프레젠테이션을 생성해주세요. 먼저 read_file로 파일을 읽고 핵심 내용을 파악하세요.\n\n파일: '+file;
            }

            prompt+='\n\n[슬라이드 설정]\n';
            prompt+='- 대상 청중: '+audience+'\n';
            prompt+='- 슬라이드 수: 약 '+count+'장\n';
            prompt+='- 출력 언어: '+lang+'\n';
            if(custom) prompt+='- 추가 지시: '+custom+'\n';

            // === 템플릿 모드 ===
            if(mode==='template'){
                var tplFile=$.trim($('#sd-tpl-file').val());
                if(!tplFile){alert('템플릿 파일 경로를 입력해주세요');return}
                var compose=$('#sd-tpl-compose option:selected').text();
                prompt+='\n[PPT 템플릿 기반 생성 - 핵심 작업 절차]\n';
                prompt+='템플릿 파일: '+tplFile+'\n';
                prompt+='구성 방식: '+compose+'\n\n';
                prompt+='반드시 아래 절차를 순서대로 따르세요:\n\n';
                prompt+='## STEP 1: 템플릿 구조 완전 분석\n';
                prompt+='1. run_command로 Python 실행: python-pptx를 사용하여 템플릿 분석 스크립트를 작성/실행\n';
                prompt+='2. 분석 항목:\n';
                prompt+='   - 전체 슬라이드 수, 각 슬라이드의 레이아웃 이름\n';
                prompt+='   - 각 슬라이드의 모든 placeholder 목록 (idx, 이름, 타입: 제목/본문/이미지/차트 등)\n';
                prompt+='   - 각 placeholder의 위치(left,top,width,height), 폰트 크기, 색상\n';
                prompt+='   - 슬라이드 마스터/레이아웃별 사용 가능한 placeholder 타입 목록\n';
                prompt+='   - 배경 스타일 (단색/그래디언트/이미지)\n';
                prompt+='   - 사용된 테마 색상, 폰트 정보\n';
                prompt+='3. 분석 결과를 JSON으로 정리하여 "각 슬라이드 레이아웃이 어떤 콘텐츠에 적합한지" 매핑\n';
                prompt+='   예: "Title Slide" → 표지용, "Two Content" → 비교/대조, "Section Header" → 챕터 구분\n\n';
                prompt+='## STEP 2: 콘텐츠 구조화\n';
                prompt+='1. 소스 콘텐츠(위에서 지정한)를 분석하여 핵심 메시지와 섹션을 도출\n';
                prompt+='2. 각 섹션의 콘텐츠 유형을 분류:\n';
                prompt+='   - 표지/제목, 목차, 핵심 수치/통계, 비교/대조, 프로세스/흐름, 이미지 중심, 텍스트 중심, 요약/결론\n';
                prompt+='3. 각 콘텐츠 유형에 가장 적합한 템플릿 레이아웃을 매칭\n';
                prompt+='   ★ 핵심: 템플릿의 슬라이드 원래 순서에 얽매이지 말 것!\n';
                prompt+='   ★ 같은 레이아웃을 여러 번 재사용 가능\n';
                prompt+='   ★ 콘텐츠 흐름에 맞게 레이아웃을 자유롭게 조합\n\n';
                prompt+='## STEP 3: PPTX 생성\n';
                prompt+='1. python-pptx로 새 Presentation 객체 생성\n';
                prompt+='2. 템플릿에서 슬라이드 레이아웃을 가져와 사용\n';
                prompt+='3. STEP 2의 매핑에 따라 슬라이드를 순서대로 추가:\n';
                prompt+='```python\n';
                prompt+='from pptx import Presentation\n';
                prompt+='from pptx.util import Inches, Pt, Emu\n';
                prompt+='from pptx.dml.color import RGBColor\n';
                prompt+='from copy import deepcopy\n';
                prompt+='import lxml.etree as etree\n\n';
                prompt+='# 템플릿 로드\n';
                prompt+='tpl = Presentation("'+tplFile+'")\n\n';
                prompt+='# 방법 A: 슬라이드 레이아웃 사용 (새 슬라이드 추가)\n';
                prompt+='# layout = tpl.slide_layouts[레이아웃_인덱스]\n';
                prompt+='# slide = tpl.slides.add_slide(layout)\n\n';
                prompt+='# 방법 B: 기존 슬라이드 복제 (디자인 요소 완전 보존)\n';
                prompt+='# def duplicate_slide(prs, slide_index):\n';
                prompt+='#     source = prs.slides[slide_index]\n';
                prompt+='#     layout = source.slide_layout\n';
                prompt+='#     new_slide = prs.slides.add_slide(layout)\n';
                prompt+='#     for shape in source.shapes:\n';
                prompt+='#         el = deepcopy(shape.element)\n';
                prompt+='#         new_slide.shapes._spTree.append(el)\n';
                prompt+='#     return new_slide\n';
                prompt+='```\n\n';
                prompt+='4. 각 슬라이드의 placeholder에 콘텐츠 채우기:\n';
                prompt+='   - 제목 placeholder → 섹션 제목\n';
                prompt+='   - 본문 placeholder → 핵심 내용 (글머리 기호 포함)\n';
                prompt+='   - 이미지 placeholder → 적절한 도형/차트/아이콘으로 대체\n';
                prompt+='   - placeholder가 아닌 텍스트 박스도 확인하여 수정\n';
                prompt+='5. 텍스트 서식은 템플릿의 기존 스타일을 최대한 유지:\n';
                prompt+='   - 폰트, 크기, 색상, 정렬을 템플릿에서 읽어서 동일하게 적용\n';
                prompt+='   - 새 텍스트 추가 시에도 해당 placeholder의 기본 서식을 따름\n';
                prompt+='6. 불필요한 원본 슬라이드 제거 (사용하지 않은 템플릿 슬라이드)\n\n';
                prompt+='## STEP 4: 검증\n';
                prompt+='1. 생성된 PPTX를 다시 python-pptx로 열어서 확인:\n';
                prompt+='   - 전체 슬라이드 수가 목표와 일치하는지\n';
                prompt+='   - 각 슬라이드에 빈 placeholder나 템플릿 원본 텍스트가 남아있지 않은지\n';
                prompt+='   - 텍스트가 잘리거나 넘치지 않는지\n';
                prompt+='2. 문제 발견 시 수정 후 재저장\n\n';
                prompt+='[중요 원칙]\n';
                prompt+='- 템플릿의 디자인(색상, 폰트, 도형, 배경)을 100% 유지하면서 내용만 교체\n';
                prompt+='- 슬라이드 순서는 콘텐츠 흐름에 맞게 자유롭게 구성 (템플릿 원본 순서 무시)\n';
                prompt+='- 하나의 레이아웃을 여러 번 사용 가능 (내용이 많으면 같은 레이아웃 반복)\n';
                prompt+='- placeholder 외의 장식 요소(도형, 로고, 선)는 그대로 보존\n';
                prompt+='- 출력 파일명: output_presentation.pptx\n';
            }
            // === 새로 만들기 모드 ===
            else {
                var format=$('input[name="sd-format"]:checked').val();
                var theme=$('#sd-theme option:selected').text();
                prompt+='- 디자인 테마: '+theme+'\n';
                if(format==='pptx'){
                    prompt+='\n[PPTX 생성 규칙]\n';
                    prompt+='1. python-pptx 라이브러리를 사용하여 .pptx 파일 생성 (run_command로 Python 스크립트 실행)\n';
                    prompt+='2. 파일명: presentation_[주제요약].pptx\n';
                    prompt+='3. 각 슬라이드 구성:\n';
                    prompt+='   - 표지 슬라이드: 제목 + 부제목 + 날짜\n';
                    prompt+='   - 목차 슬라이드\n';
                    prompt+='   - 본문 슬라이드: 명확한 제목 + 핵심 포인트 (3-5개) + 시각적 요소\n';
                    prompt+='   - 요약/마무리 슬라이드\n';
                    prompt+='4. 디자인 요소: 테마 색상 일관 적용, 도형/그래프/표 활용\n';
                    prompt+='5. 발표자 노트(speaker notes) 포함\n';
                    prompt+='6. 깔끔한 레이아웃과 적절한 여백 사용\n';
                } else {
                    prompt+='\n[HTML 슬라이드 생성 규칙]\n';
                    prompt+='1. HTML+CSS+JS 단일 파일로 생성 (write_file 사용)\n';
                    prompt+='2. 파일명: slides_[주제요약].html\n';
                    prompt+='3. 각 슬라이드는 <section> 태그로 분리\n';
                    prompt+='4. 키보드 좌/우 화살표로 슬라이드 이동\n';
                    prompt+='5. 슬라이드 번호 표시 + 진행 바\n';
                    prompt+='6. 전환 애니메이션 (fade/slide)\n';
                    prompt+='7. 16:9 비율 고정 + 중앙 정렬\n';
                    prompt+='8. 인쇄 스타일시트 포함 (Ctrl+P로 PDF 변환 가능)\n';
                    prompt+='9. SVG 아이콘, CSS 그래디언트 활용한 시각적 디자인\n';
                    prompt+='10. Google Fonts CDN (Noto Sans KR 등) 활용\n';
                }
            }
            $('#msg-input').val(prompt);
            sendMessage();
        }}
    ]);
    setTimeout(function(){
        // 모드 전환
        $('input[name="sd-mode"]').on('change',function(){
            var isTemplate=$(this).val()==='template';
            $('#sd-template-section').toggle(isTemplate);
            $('#sd-scratch-section').toggle(!isTemplate);
        });
        // 소스 전환
        $('#sd-source').on('change',function(){
            var v=$(this).val();
            $('#sd-source-topic').toggle(v==='topic');
            $('#sd-source-file').toggle(v==='file');
            $('#sd-source-web').toggle(v==='web');
        });
        $('#sd-topic').focus();
    },100);
}

function showFigmaModal(){
    // 먼저 Figma 토큰 상태 확인
    $.getJSON(apiUrl('/api/settings'),function(s){
        if(!s.has_figma_token){
            showModal('Figma → HTML',
                '<div class="err-box" style="margin-bottom:12px">⚠️ Figma 토큰이 설정되지 않았습니다.</div>'+
                '<div style="font-size:12px;color:var(--tx2);line-height:1.8;margin-bottom:12px">'+
                '① <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" style="color:var(--blue)">Figma 설정 → Security → Personal access tokens</a>에서 토큰 생성<br>'+
                '② 아래에 토큰을 입력하세요</div>'+
                '<input type="text" class="modal-input" id="figma-token-input" placeholder="figd_XXXX..." autofocus>',
                [{label:'취소'},{label:'토큰 저장',cls:'primary',action:function(){
                    var t=$.trim($('#figma-token-input').val());if(!t)return;
                    $.ajax({url:apiUrl('/api/settings'),type:'POST',contentType:'application/json',data:JSON.stringify({figma_token:t}),
                        success:function(){showModal('✅ 저장 완료','Figma 토큰이 등록되었습니다. 이제 Figma→HTML 변환을 사용할 수 있습니다.',[{label:'확인',cls:'primary',action:showFigmaModal}])},
                        error:function(x){showModal('❌ 오류',esc(x.responseJSON?.detail||'토큰이 유효하지 않습니다.'),[{label:'확인'}])}
                    });
                }}]
            );
            setTimeout(function(){$('#figma-token-input').focus()},100);
        } else {
            showModal('Figma → HTML',
                '<div style="font-size:11px;color:var(--tx3);margin-bottom:8px">🔑 Figma 연동됨 ('+esc(s.figma_token_masked)+') <a href="#" id="figma-change-token" style="color:var(--blue)">변경</a></div>'+
                '<input type="text" class="modal-input" id="figma-url" placeholder="https://www.figma.com/design/..." autofocus>'+
                '<div style="font-size:11px;color:var(--tx3);margin-top:8px;line-height:1.6">Figma에서 디자인 URL을 복사해서 붙여넣으세요.<br>파일 전체 또는 특정 프레임(node-id 포함) URL 모두 지원합니다.</div>',
                [{label:'취소'},{label:'변환 시작',cls:'primary',action:function(){
                    var u=$.trim($('#figma-url').val());if(!u)return;
                    $('#msg-input').val('다음 Figma 디자인을 분석하고 반응형 HTML/CSS로 변환해주세요. figma_get_file과 figma_get_styles 도구를 사용하여 디자인 구조와 스타일을 먼저 파악한 후, 최대한 원본에 가깝게 구현하세요: '+u);
                    sendMessage();
                }}]
            );
            setTimeout(function(){
                $('#figma-url').focus().on('keydown',function(e){if(e.key==='Enter'){e.preventDefault();$('.modal-btn.primary').click()}});
                $('#figma-change-token').on('click',function(e){e.preventDefault();showSettingsModal()});
            },100);
        }
    }).fail(function(){
        // API 실패 시 기본 동작
        showModal('Figma → HTML','Figma URL을 입력하세요.<br><br><input type="text" class="modal-input" id="figma-url" placeholder="https://www.figma.com/design/..." autofocus>',[{label:'취소'},{label:'변환',cls:'primary',action:function(){var u=$.trim($('#figma-url').val());if(!u)return;$('#msg-input').val('다음 Figma를 반응형 HTML/CSS로 변환해주세요: '+u);sendMessage()}}]);
    });
}

function showSettingsModal(initialTab){
    if(!initialTab || typeof initialTab !== 'string') initialTab = 'st-skills';
    $.getJSON(apiUrl('/api/settings'),function(s){
        $.getJSON(apiUrl('/api/skills'),function(sk){
            var figmaHtml =
                '<h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Figma 연동</h4>'+
                (s.has_figma_token?
                    '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:10px">'+
                    '<span style="color:var(--green);font-size:14px">✓</span>'+
                    '<span style="font-size:12px;flex:1">연동됨: <code style="font-family:var(--mono);font-size:11px">'+esc(s.figma_token_masked)+'</code></span>'+
                    '<button class="modal-btn" style="padding:4px 12px;font-size:11px" id="settings-del-figma">삭제</button></div>'
                :
                    '<div style="font-size:12px;color:var(--tx2);margin-bottom:8px;line-height:1.7">Figma Personal Access Token을 등록하면 디자인을 HTML/CSS로 변환할 수 있습니다.</div>'
                )+
                '<input type="text" class="modal-input" id="settings-figma-token" placeholder="새 토큰 입력 (figd_XXXX...)" style="margin-top:0">'+
                '<div style="font-size:10px;color:var(--tx3);margin-top:6px">Figma → Settings → Security → Personal access tokens에서 발급</div>';

            // 스킬 목록 HTML
            var mySkillsHtml = '';
            if(sk.my_skills.length){
                sk.my_skills.forEach(function(s){
                    var mdCount = (s.md_files||[]).length;
                    var sharedCount = (s.shared_with||[]).length;
                    var descPreview = s.description ? '<div class="sk-desc" title="클릭하여 설명 편집" onclick="editSkillDesc(\''+s._id+'\',this)" style="font-size:11px;color:var(--tx2);margin-top:2px;cursor:pointer;padding:2px 4px;border-radius:4px;line-height:1.4;white-space:pre-wrap">'+esc(s.description)+'</div>' :
                        '<div class="sk-desc sk-desc-empty" title="클릭하여 설명 추가" onclick="editSkillDesc(\''+s._id+'\',this)" style="font-size:11px;color:var(--tx3);margin-top:2px;cursor:pointer;padding:2px 4px;border-radius:4px;font-style:italic">+ 설명 추가 (자동 매칭에 활용됩니다)</div>';
                    mySkillsHtml += '<div class="sk-item" data-id="'+s._id+'">'+
                        '<div class="sk-toggle'+(s.active?' on':'')+'" data-id="'+s._id+'" data-type="my"></div>'+
                        '<div class="sk-info"><div class="sk-name">'+esc(s.name)+' <span class="sk-badge own">내 스킬</span></div>'+
                        '<div class="sk-meta">📁 '+esc(s.folder)+' · 📄 '+mdCount+'개 MD'+(sharedCount?' · 👥 '+sharedCount+'명 공유':'')+'</div>'+
                        descPreview+'</div>'+
                        '<div class="sk-actions">'+
                        '<button onclick="shareSkillModal(\''+s._id+'\',\''+esc(s.name)+'\')">공유</button>'+
                        '<button onclick="rescanSkill(\''+s._id+'\')">🔄</button>'+
                        '<button class="danger" onclick="deleteSkill(\''+s._id+'\',\''+esc(s.name)+'\')">삭제</button>'+
                        '</div></div>';
                });
            } else {
                mySkillsHtml = '<div class="sk-empty">등록된 스킬이 없습니다. 아래에서 새 스킬을 등록하세요.</div>';
            }

            var sharedSkillsHtml = '';
            if(sk.shared_skills.length){
                sk.shared_skills.forEach(function(s){
                    var mdCount = (s.md_files||[]).length;
                    sharedSkillsHtml += '<div class="sk-item" data-id="'+s._id+'">'+
                        '<div class="sk-toggle on" data-id="'+s._id+'" data-type="shared"></div>'+
                        '<div class="sk-info"><div class="sk-name">'+esc(s.name)+' <span class="sk-badge shared">공유받음</span></div>'+
                        '<div class="sk-meta">👤 '+esc(s.owner)+' · 📄 '+mdCount+'개 MD'+(s.description?' · '+esc(s.description):'')+'</div></div>'+
                        '</div>';
                });
            } else {
                sharedSkillsHtml = '<div class="sk-empty">공유받은 스킬이 없습니다.</div>';
            }

            var skillsHtml =
                '<div style="margin-bottom:12px">'+mySkillsHtml+'</div>'+
                (sk.shared_skills.length?'<h4 style="font-size:13px;font-weight:600;margin:12px 0 8px">공유받은 스킬</h4>'+sharedSkillsHtml:'')+
                '<h4 style="font-size:13px;font-weight:600;margin:16px 0 8px">📌 새 스킬 등록</h4>'+
                '<div style="display:flex;gap:6px;margin-bottom:6px">'+
                '<input type="text" class="modal-input" id="sk-new-name" placeholder="스킬 이름" style="margin:0;flex:1">'+
                '<div style="display:flex;flex:1.5;gap:0;position:relative">'+
                '<input type="text" class="modal-input" id="sk-new-folder" placeholder="폴더를 선택하세요" style="margin:0;flex:1;border-radius:var(--radius-sm) 0 0 var(--radius-sm);cursor:pointer;background:var(--bg)" readonly>'+
                '<button class="modal-btn" id="sk-folder-browse" style="margin:0;border-radius:0 var(--radius-sm) var(--radius-sm) 0;padding:10px 12px;border-left:0;white-space:nowrap" title="폴더 선택">📂</button>'+
                '</div>'+
                '</div>'+
                '<div id="sk-folder-info" style="font-size:11px;color:var(--tx3);margin-bottom:6px;display:none"></div>'+
                '<textarea class="modal-input" id="sk-new-desc" placeholder="설명 (선택)" style="margin:0 0 8px;resize:vertical;min-height:60px;line-height:1.5" rows="3"></textarea>'+
                '<div style="font-size:10px;color:var(--tx3);margin-top:6px;line-height:1.5">'+
                '폴더 안의 .md 파일들이 스킬로 등록됩니다. AI가 작업 시 활성화된 스킬의 내용을 자동으로 참고합니다.</div>';

            var body =
                '<div class="stab-wrap">'+
                '<div class="stab active" data-panel="st-skills">📚 스킬 관리</div>'+
                '<div class="stab" data-panel="st-figma">⚙️ Figma 연동</div>'+
                '</div>'+
                '<div class="stab-panel active" id="st-skills">'+skillsHtml+'</div>'+
                '<div class="stab-panel" id="st-figma">'+figmaHtml+'</div>';

            showModal('⚙️ 설정', body, [{label:'닫기'}]);

            function updateSettingsButtons(panel){
                var $b=$('#modal-btns');
                $b.empty();
                $('<button class="modal-btn">닫기</button>').on('click',closeModal).appendTo($b);
                if(panel==='st-figma'){
                    $('<button class="modal-btn primary">Figma 토큰 저장</button>').on('click',function(){
                        var t=$.trim($('#settings-figma-token').val());
                        if(!t){closeModal();return}
                        $.ajax({url:apiUrl('/api/settings'),type:'POST',contentType:'application/json',data:JSON.stringify({figma_token:t}),
                            success:function(r){showModal('✅ 저장 완료',r.message||'설정이 저장되었습니다.',[{label:'확인',cls:'primary'}])},
                            error:function(x){showModal('❌ 오류',esc(x.responseJSON?.detail||'저장 실패'),[{label:'확인'}])}
                        });
                    }).appendTo($b);
                } else if(panel==='st-skills'){
                    $('<button class="modal-btn primary" id="sk-register-btn">📝 스킬 등록</button>').on('click',function(){
                        var name=$.trim($('#sk-new-name').val()),folder=$.trim($('#sk-new-folder').val()),desc=$.trim($('#sk-new-desc').val());
                        var owner=$('#sk-new-folder').data('owner')||'';
                        if(!name||!folder){showNotification('스킬 이름과 폴더 경로를 입력하세요');return}
                        $.ajax({url:apiUrl('/api/skills'),type:'POST',contentType:'application/json',data:JSON.stringify({name:name,folder:folder,description:desc,owner:owner}),
                            success:function(r){showNotification('✅ 스킬 등록 완료 ('+r.md_files.length+'개 MD)');showSettingsModal('st-skills')},
                            error:function(x){showNotification('❌ '+(x.responseJSON?.detail||'등록 실패'))}
                        });
                    }).appendTo($b);
                }
            }
            updateSettingsButtons(initialTab);
            // 초기 탭 활성화
            if(initialTab !== 'st-skills'){
                $('.stab').removeClass('active');
                $('.stab[data-panel="'+initialTab+'"]').addClass('active');
                $('.stab-panel').removeClass('active');
                $('#'+initialTab).addClass('active');
            }

            // 탭 전환
            setTimeout(function(){
                $('.stab').on('click',function(){
                    var panel=$(this).data('panel');
                    $('.stab').removeClass('active');$(this).addClass('active');
                    $('.stab-panel').removeClass('active');$('#'+panel).addClass('active');
                    updateSettingsButtons(panel);
                });
                // Figma 삭제
                $('#settings-del-figma').on('click',function(){
                    showModal('🗑 Figma 토큰 삭제','저장된 Figma 토큰을 삭제하시겠습니까?',[
                        {label:'취소'},
                        {label:'삭제',cls:'danger',action:function(){
                            $.ajax({url:apiUrl('/api/settings/figma'),type:'DELETE',success:function(){showSettingsModal()}});
                        }}
                    ]);
                });
                // 스킬 토글
                $('.sk-toggle').on('click',function(){
                    var $t=$(this),id=$t.data('id'),type=$t.data('type');
                    var isOn=$t.hasClass('on');
                    if(type==='my'){
                        $.ajax({url:apiUrl('/api/skills/'+id),type:'PUT',contentType:'application/json',data:JSON.stringify({active:!isOn}),success:function(){$t.toggleClass('on')}});
                    } else {
                        $.ajax({url:apiUrl('/api/skills/'+id+'/toggle'),type:'POST',contentType:'application/json',data:JSON.stringify({active:!isOn}),success:function(){$t.toggleClass('on')}});
                    }
                });
                // 스킬 폴더 브라우저
                $('#sk-folder-browse,#sk-new-folder').on('click',function(){openFolderBrowser()});
            },100);
        });
    });
}
function deleteSkill(id,name){
    showModal('스킬 삭제','<b>'+esc(name)+'</b> 스킬을 삭제하시겠습니까?',[
        {label:'취소'},
        {label:'삭제',cls:'danger',action:function(){
            $.ajax({url:apiUrl('/api/skills/'+id),type:'DELETE',success:function(){showNotification('삭제됨');showSettingsModal('st-skills')}});
        }}
    ]);
}
function rescanSkill(id){
    $.ajax({url:apiUrl('/api/skills/'+id),type:'PUT',contentType:'application/json',data:JSON.stringify({rescan:true}),
        success:function(){showNotification('✅ 재스캔 완료');showSettingsModal('st-skills')},
        error:function(x){showNotification('❌ '+(x.responseJSON?.detail||'실패'))}
    });
}
function editSkillDesc(id, el){
    var $el=$(el);
    var currentDesc=$el.hasClass('sk-desc-empty')?'':$el.text();
    var $ta=$('<textarea class="modal-input" style="font-size:11px;min-height:48px;resize:vertical;line-height:1.5;padding:6px 8px;margin:0" rows="3" placeholder="스킬 설명을 입력하세요 (자동 매칭에 활용됩니다)"></textarea>').val(currentDesc);
    var $actions=$('<div style="display:flex;gap:4px;margin-top:4px"></div>');
    var $save=$('<button class="modal-btn primary" style="padding:3px 12px;font-size:11px">저장</button>');
    var $cancel=$('<button class="modal-btn" style="padding:3px 12px;font-size:11px">취소</button>');
    $actions.append($cancel).append($save);
    $el.replaceWith($('<div class="sk-desc-edit"></div>').append($ta).append($actions));
    $ta.focus();
    $save.on('click',function(){
        var newDesc=$.trim($ta.val());
        $.ajax({url:apiUrl('/api/skills/'+id),type:'PUT',contentType:'application/json',
            data:JSON.stringify({description:newDesc}),
            success:function(){showNotification('✅ 설명 저장됨');showSettingsModal('st-skills')},
            error:function(x){showNotification('❌ '+(x.responseJSON?.detail||'저장 실패'))}
        });
    });
    $cancel.on('click',function(){showSettingsModal('st-skills')});
}
function openFolderBrowser(){
    $('#sk-folder-popup').remove();
    var $popup=$('<div id="sk-folder-popup" style="position:fixed;z-index:1100;background:var(--white);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);width:340px;max-height:440px;display:flex;flex-direction:column;animation:modalIn .15s ease"></div>');
    var $btn=$('#sk-folder-browse');
    var btnRect=$btn[0].getBoundingClientRect();
    var top=btnRect.top, left=btnRect.right+8;
    if(left+340>window.innerWidth) left=btnRect.left-348;
    if(top+440>window.innerHeight) top=window.innerHeight-450;
    if(top<10) top=10;
    $popup.css({top:top+'px',left:left+'px'});

    $popup.append(
        '<div style="padding:10px 14px;border-bottom:1px solid var(--border-lt);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">'+
        '<span style="font-size:13px;font-weight:600">📂 폴더 선택</span>'+
        '<button id="sk-fp-close" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--tx3)">✕</button></div>'+
        '<div style="display:flex;border-bottom:1px solid var(--border-lt);flex-shrink:0">'+
        '<div class="sk-fp-tab active" data-src="my" style="flex:1;text-align:center;padding:7px;font-size:11px;font-weight:500;cursor:pointer;border-bottom:2px solid var(--blue);color:var(--blue)">📁 내 폴더</div>'+
        '<div class="sk-fp-tab" data-src="shared" style="flex:1;text-align:center;padding:7px;font-size:11px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--tx3)">🤝 공유 폴더</div></div>'+
        '<div id="sk-fp-path" style="padding:6px 14px;font-size:11px;color:var(--blue);font-family:var(--mono);background:var(--bg);border-bottom:1px solid var(--border-lt);flex-shrink:0;cursor:pointer" title="루트로 이동">Home</div>'+
        '<div id="sk-fp-md-info" style="padding:4px 14px;font-size:10px;background:var(--bg);border-bottom:1px solid var(--border-lt);flex-shrink:0;display:none"></div>'+
        '<div id="sk-fp-list" style="flex:1;overflow-y:auto;padding:6px"></div>'+
        '<div style="padding:8px 14px;border-top:1px solid var(--border-lt);flex-shrink:0">'+
        '<button class="modal-btn primary" id="sk-fp-select" style="width:100%;padding:6px;font-size:12px">이 폴더 선택</button></div>'
    );
    $('body').append($popup);

    var fpSrc='my', fpOwner=null, fpCurrentPath='.';

    function loadFolders(path){
        fpCurrentPath=path;
        var display=path==='.'?'Home':'Home / '+path.replace(/\//g,' / ');
        if(fpSrc==='shared'&&fpOwner) display='👤 '+fpOwner+' / '+(path==='.'?'':path.replace(/\//g,' / '));
        $('#sk-fp-path').html(display);
        $('#sk-fp-list').html('<div style="text-align:center;padding:16px;color:var(--tx3);font-size:12px">로딩...</div>');
        var url=apiUrl('/api/folders?path='+encodeURIComponent(path));
        if(fpSrc==='shared'&&fpOwner) url+='&owner='+encodeURIComponent(fpOwner);
        $.getJSON(url,function(r){
            var html='';
            if(path!=='.'){
                var parent=path.indexOf('/')>-1?path.substring(0,path.lastIndexOf('/')):'.';
                html+='<div class="sk-fp-item" data-path="'+parent+'" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-radius:6px;font-size:12px;color:var(--tx2)"><span>⬆️</span><span>상위 폴더로</span></div>';
            }
            if(r.folders&&r.folders.length){
                r.folders.forEach(function(f){
                    var subPath=path==='.'?f:path+'/'+f;
                    html+='<div class="sk-fp-item" data-path="'+subPath+'" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-radius:6px;font-size:12px"><span>📁</span><span style="flex:1">'+esc(f)+'</span><span style="color:var(--tx3);font-size:10px">▶</span></div>';
                });
            } else if(!html){
                html='<div style="text-align:center;padding:16px;color:var(--tx3);font-size:12px">하위 폴더 없음</div>';
            }
            $('#sk-fp-list').html(html);
            if(r.md_count>0){
                var sizeInfo=r.total_size?' · 💾 '+fmtSize(r.total_size):'';
                $('#sk-fp-md-info').html('📄 .md 파일 <b>'+r.md_count+'</b>개'+sizeInfo).css('color','var(--green)').show();
            } else {
                var sizeInfo=r.total_size?' · 💾 '+fmtSize(r.total_size):'';
                $('#sk-fp-md-info').html('⚠️ .md 파일 없음'+sizeInfo).css('color','var(--orange)').show();
            }
            $('.sk-fp-item').on('click',function(){loadFolders($(this).data('path'))});
            $('.sk-fp-item').on('mouseenter',function(){$(this).css('background','var(--blue-lt)')}).on('mouseleave',function(){$(this).css('background','')});
        });
    }

    function loadSharedOwners(){
        fpCurrentPath='.';fpOwner=null;
        $('#sk-fp-path').html('🤝 공유 폴더');
        $('#sk-fp-md-info').hide();
        $('#sk-fp-list').html('<div style="text-align:center;padding:16px;color:var(--tx3);font-size:12px">로딩...</div>');
        $.getJSON(apiUrl('/api/shares/received'),function(r){
            var html='';
            if(r.shares&&r.shares.length){
                r.shares.forEach(function(s){
                    html+='<div class="sk-fp-shared-owner" data-owner="'+esc(s.owner)+'" data-folder="'+esc(s.folder_path||'.')+'" style="display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer;border-radius:6px;font-size:12px">'+
                    '<span>👤</span><span style="flex:1"><b>'+esc(s.owner)+'</b><span style="color:var(--tx3);margin-left:6px">'+esc(s.folder_name||s.folder_path||'전체')+'</span></span>'+
                    '<span style="font-size:10px;color:var(--tx3)">▶</span></div>';
                });
            } else {
                html='<div style="text-align:center;padding:16px;color:var(--tx3);font-size:12px">공유받은 폴더가 없습니다</div>';
            }
            $('#sk-fp-list').html(html);
            $('.sk-fp-shared-owner').on('click',function(){
                fpOwner=$(this).data('owner');
                var folder=$(this).data('folder');
                loadFolders(folder&&folder!=='.'?folder:'.');
            });
            $('.sk-fp-shared-owner').on('mouseenter',function(){$(this).css('background','var(--blue-lt)')}).on('mouseleave',function(){$(this).css('background','')});
        });
    }

    // 탭 전환
    $('.sk-fp-tab').on('click',function(){
        $('.sk-fp-tab').removeClass('active').css({'border-bottom-color':'transparent','color':'var(--tx3)'});
        $(this).addClass('active').css({'border-bottom-color':'var(--blue)','color':'var(--blue)'});
        fpSrc=$(this).data('src');
        if(fpSrc==='my'){fpOwner=null;loadFolders('.')}
        else{loadSharedOwners()}
    });

    loadFolders('.');

    // 루트로 이동
    $('#sk-fp-path').on('click',function(){
        if(fpSrc==='shared'&&!fpOwner){loadSharedOwners()}
        else if(fpSrc==='shared'&&fpOwner){loadFolders('.')}
        else{loadFolders('.')}
    });

    // 선택
    $('#sk-fp-select').on('click',function(){
        var selected=fpCurrentPath==='.'?'':fpCurrentPath;
        if(!selected){showNotification('폴더를 선택하세요');return}
        $('#sk-new-folder').val(selected);
        // 공유 폴더인 경우 owner 정보도 저장
        if(fpSrc==='shared'&&fpOwner){
            $('#sk-new-folder').data('owner',fpOwner);
            $('#sk-folder-info').html('🤝 <b>'+esc(fpOwner)+'</b>의 공유 폴더').css('color','var(--blue)').show();
        } else {
            $('#sk-new-folder').removeData('owner');
        }
        var checkUrl=apiUrl('/api/folders?path='+encodeURIComponent(selected));
        if(fpSrc==='shared'&&fpOwner) checkUrl+='&owner='+encodeURIComponent(fpOwner);
        $.getJSON(checkUrl,function(r){
            var sizeStr=r.total_size?(' · 💾 '+fmtSize(r.total_size)):'';
            var infoHtml=fpSrc==='shared'&&fpOwner?'🤝 '+esc(fpOwner)+' / '+esc(selected)+' · ':'📁 '+esc(selected)+' · ';
            if(r.md_count>0){
                $('#sk-folder-info').html(infoHtml+'📄 .md 파일 <b>'+r.md_count+'</b>개'+sizeStr).css('color','var(--green)').show();
            } else {
                $('#sk-folder-info').html(infoHtml+'⚠️ .md 파일 없음'+sizeStr).css('color','var(--orange)').show();
            }
        });
        $('#sk-folder-popup').remove();
    });

    $('#sk-fp-close').on('click',function(){$('#sk-folder-popup').remove()});
    setTimeout(function(){
        $(document).one('mousedown',function closeFp(e){
            if($(e.target).closest('#sk-folder-popup,#sk-folder-browse,#sk-new-folder').length){
                $(document).one('mousedown',closeFp);
            } else {$('#sk-folder-popup').remove()}
        });
    },100);
}
function shareSkillModal(id,name){
    var picker=UserPicker({containerId:'sk-share-picker',placeholder:'이름 또는 부서로 검색',multi:true});
    var body='<div style="font-size:13px;margin-bottom:12px"><b>'+esc(name)+'</b> 스킬을 공유합니다.</div>'+picker.html;
    showModal('📤 스킬 공유',body,[
        {label:'취소'},
        {label:'공유',cls:'primary',action:function(){
            var users=picker.getSelected().map(function(u){return u.lid});
            if(!users.length){showNotification('공유할 사용자를 선택하세요');return}
            $.ajax({url:apiUrl('/api/skills/'+id+'/share'),type:'POST',contentType:'application/json',data:JSON.stringify({users:users,action:'add'}),
                success:function(){showNotification('✅ 공유 완료');showSettingsModal('st-skills')},
                error:function(x){showNotification('❌ '+(x.responseJSON?.detail||'공유 실패'))}
            });
        }}
    ]);
    picker.init();
}
// ================================================================
// 공통 사용자 검색 컴포넌트
// usage: var picker = UserPicker({ containerId:'my-container', onSelect:fn, onRemove:fn, multi:true })
//   picker.getSelected() → [{lid,name,dept}]
//   picker.destroy()
// ================================================================
function UserPicker(opts){
    var containerId=opts.containerId||'user-picker-'+Date.now();
    var onSelect=opts.onSelect||function(){};
    var onRemove=opts.onRemove||function(){};
    var multi=opts.multi!==false;
    var placeholder=opts.placeholder||'이름 또는 부서로 검색';
    var selected=[];
    var hiIdx=-1,searchTimer=null;

    var html=
        '<div id="'+containerId+'" class="up-container">'+
        '<div class="up-selected" id="'+containerId+'-sel"></div>'+
        '<div style="position:relative">'+
        '<div class="up-search-box">'+
        '<span class="material-icons-outlined" style="font-size:18px;color:var(--tx3)">search</span>'+
        '<input type="text" class="up-input" id="'+containerId+'-input" placeholder="'+placeholder+'" autocomplete="off"></div>'+
        '<div class="up-dropdown" id="'+containerId+'-dd"></div>'+
        '</div></div>';

    function render(){
        var $sel=$('#'+containerId+'-sel').empty();
        if(!selected.length){$sel.hide();return}
        $sel.show();
        selected.forEach(function(u,i){
            var $chip=$('<span class="up-chip">'+
                '<span class="up-chip-avatar">'+esc(u.name.charAt(0))+'</span>'+
                '<span class="up-chip-name">'+esc(u.name)+'</span>'+
                '<span class="up-chip-dept">'+esc(u.dept||'')+'</span>'+
                '<span class="up-chip-x">✕</span></span>');
            $chip.on('click',function(){
                selected.splice(i,1);
                render();
                onRemove(u);
            });
            $sel.append($chip);
        });
    }

    function selectUser(uid,uname,dept){
        if(selected.some(function(s){return s.lid===uid}))return;
        var u={lid:uid,name:uname,dept:dept||''};
        if(!multi)selected=[];
        selected.push(u);
        render();
        onSelect(u,selected);
        $('#'+containerId+'-input').val('');
        $('#'+containerId+'-dd').hide();
        hiIdx=-1;
    }

    function highlightItem(idx){
        var $dd=$('#'+containerId+'-dd');
        var $items=$dd.find('.up-dd-item');
        $items.removeClass('up-dd-hi');
        hiIdx=idx;
        if(hiIdx>=0&&hiIdx<$items.length){
            $items.eq(hiIdx).addClass('up-dd-hi');
            $items.eq(hiIdx)[0].scrollIntoView({block:'nearest'});
        }
    }

    function doSearch(){
        var q=$.trim($('#'+containerId+'-input').val());
        var $dd=$('#'+containerId+'-dd');
        if(!q){$dd.hide();return}
        $.getJSON(apiUrl('/api/org/search?q='+encodeURIComponent(q)),function(r){
            var items=r.users||[];
            if(!items.length){
                $dd.html('<div class="up-dd-empty">검색 결과가 없습니다</div>').show();
                return;
            }
            var h='';
            items.forEach(function(u){
                var uid=u.lid||u.userid||'';
                var uname=u.name||u.userid||'';
                var dept=u.dept||u.deptname||'';
                var isSel=selected.some(function(s){return s.lid===uid});
                h+='<div class="up-dd-item'+(isSel?' up-dd-sel':'')+'" data-uid="'+esc(uid)+'" data-name="'+esc(uname)+'" data-dept="'+esc(dept)+'">'+
                    '<span class="up-dd-avatar'+(isSel?' up-dd-avatar-sel':'')+'">'+esc(uname.charAt(0))+'</span>'+
                    '<div class="up-dd-info"><div class="up-dd-name">'+esc(uname)+'</div>'+
                    '<div class="up-dd-meta">'+esc(uid)+'@kmslab.com · '+esc(dept)+'</div></div>'+
                    (isSel?'<span class="up-dd-check">✓</span>':'')+
                    '</div>';
            });
            $dd.html(h).show();
            hiIdx=-1;
            $dd.find('.up-dd-item').on('click',function(){
                selectUser($(this).data('uid'),$(this).data('name'),$(this).data('dept'));
            }).on('mouseenter',function(){
                highlightItem($(this).index());
            });
        });
    }

    function init(){
        setTimeout(function(){
            var $input=$('#'+containerId+'-input');
            var $dd=$('#'+containerId+'-dd');
            $input.on('input',function(){
                clearTimeout(searchTimer);
                searchTimer=setTimeout(doSearch,300);
            });
            $input.on('keydown',function(e){
                var $items=$dd.find('.up-dd-item');
                var ddVisible=$dd.is(':visible');
                if(e.key==='ArrowDown'){
                    e.preventDefault();e.stopPropagation();
                    if(!ddVisible||!$items.length){doSearch();return}
                    highlightItem(hiIdx<$items.length-1?hiIdx+1:0);
                } else if(e.key==='ArrowUp'){
                    e.preventDefault();e.stopPropagation();
                    if(!ddVisible||!$items.length)return;
                    highlightItem(hiIdx>0?hiIdx-1:$items.length-1);
                } else if(e.key==='Enter'){
                    e.preventDefault();e.stopPropagation();
                    if(ddVisible&&hiIdx>=0&&hiIdx<$items.length){
                        var $s=$items.eq(hiIdx);
                        selectUser($s.data('uid'),$s.data('name'),$s.data('dept'));
                    } else { doSearch(); }
                } else if(e.key==='Escape'){
                    e.preventDefault();$dd.hide();hiIdx=-1;
                }
            });
            $(document).on('click.up'+containerId,function(e){
                if(!$(e.target).closest('#'+containerId).length)$dd.hide();
            });
            $input.focus();
            render();
        },100);
    }

    return {
        html:html,
        init:init,
        getSelected:function(){return selected},
        setSelected:function(arr){selected=arr;render()},
        destroy:function(){$(document).off('click.up'+containerId);$('#'+containerId).remove()}
    };
}

function scrollBottom(){var el=document.getElementById('messages');el.scrollTop=el.scrollHeight}
function esc(s){return $('<div>').text(s).html()}
function fmtSize(n){if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'K';return(n/1048576).toFixed(1)+'M'}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,150)+'px'}

// ================================================================
// REST API 백그라운드 작업 관리
// ================================================================
var currentLeftTab='chat';
var restPollingTimers={};

function switchLeftTab(tab){
    if(tab==='project'){
        // 프로젝트: 좌측 대화 영역은 그대로 유지, 가운데만 프로젝트로 변경
        $('.lp-tab-btn').removeClass('active');$('.lp-tab-btn[data-tab="project"]').addClass('active');
        showProjectPages('list');
        loadProjects(true);
        return;
    }
    currentLeftTab=tab;
    $('.lp-tab-btn').removeClass('active');$('.lp-tab-btn[data-tab="'+tab+'"]').addClass('active');
    $('#log-list,#rest-task-list,#project-list').hide();
    if(tab==='chat'){
        showProjectPages('hide');
        $('#log-list').show();$('#lp-tab-title').text('요청한 업무');loadChatLogs(true);
    }else{
        showProjectPages('hide');
        $('#rest-task-list').show();$('#lp-tab-title').text('스케줄 작업');loadRestTasks(true);
    }
}

// ================================================================
// 프로젝트 관리
// ================================================================
var _projListState={skip:0,total:0};
function loadProjects(reset){
    if(reset){_projListState.skip=0;_projListState.total=0;$('#proj-grid').empty()}
    var limit=10;
    $.getJSON(apiUrl('/api/projects'),{skip:_projListState.skip,limit:limit},function(d){
        _projListState.total=d.total||0;
        var $g=$('#proj-grid');
        $g.find('.proj-more-wrap').remove();
        // 좌측 간이 목록은 처음에만 렌더링
        if(_projListState.skip===0){
            var $lp=$('#proj-items-lp').empty();
        }
        if(!d.projects||!d.projects.length){
            if(_projListState.skip===0) $g.html('<div class="proj-empty-grid"><span class="material-icons-outlined" style="font-size:48px;opacity:.3">folder_special</span><br>프로젝트가 없습니다.<br>새 프로젝트를 만들어보세요.</div>');
            return;
        }
        d.projects.forEach(function(p){
            var dt=p.updated_at?timeAgo(p.updated_at):'';
            var fc=p.files?p.files.length:0;
            var $card=$('<div class="proj-card"></div>').data('pid',p._id);
            $card.html('<div class="proj-card-name">'+esc(p.name)+'</div>'+
                (p.description?'<div class="proj-card-desc">'+esc(p.description)+'</div>':'<div class="proj-card-desc" style="color:var(--tx3)">설명 없음</div>')+
                '<div class="proj-card-meta"><span>📎 '+fc+'개 파일</span><span>'+dt+'</span></div>');
            $card.on('click',function(){openProjectDetail($(this).data('pid'))});
            $g.append($card);
            // 좌측 간이 목록
            if(_projListState.skip===0){
                var $li=$('<div class="proj-lp-item'+(p._id===activeProjectId?' active':'')+'"></div>').data('pid',p._id);
                $li.html('<div class="pli-name">📁 '+esc(p.name)+'</div><div class="pli-meta">'+dt+'</div>');
                $li.on('click',function(){openProjectDetail($(this).data('pid'))});
                $('#proj-items-lp').append($li);
            }
        });
        _projListState.skip+=d.projects.length;
        // 더보기 버튼
        if(_projListState.skip<_projListState.total){
            var $more=$('<div class="proj-more-wrap"><button class="proj-more-btn">더보기 ('+(_projListState.total-_projListState.skip)+'개 남음)</button></div>');
            $more.find('button').on('click',function(){loadProjects(false)});
            $g.append($more);
        }
    });
}
function timeAgo(isoStr){
    if(!isoStr)return '';
    var d=new Date(isoStr),now=new Date(),diff=Math.floor((now-d)/1000);
    if(diff<60) return '방금 전';
    if(diff<3600) return Math.floor(diff/60)+'분 전';
    if(diff<86400) return Math.floor(diff/3600)+'시간 전';
    if(diff<2592000) return Math.floor(diff/86400)+'일 전';
    return isoStr.substring(0,10);
}

function showProjectCreateModal(editData){
    var isEdit=!!editData;
    var html='<div style="display:flex;flex-direction:column;gap:12px">'+
        '<div><label style="font-size:12px;font-weight:600;color:var(--tx)">프로젝트명 *</label><input id="proj-name-input" class="proj-modal-input" placeholder="프로젝트 이름" value="'+esc(editData?editData.name:'')+'"></div>'+
        '<div><label style="font-size:12px;font-weight:600;color:var(--tx)">설명</label><input id="proj-desc-input" class="proj-modal-input" placeholder="프로젝트 설명 (선택)" value="'+esc(editData?editData.description:'')+'"></div>'+
        '<div><label style="font-size:12px;font-weight:600;color:var(--tx)">지침</label><textarea id="proj-instr-input" class="proj-modal-input" rows="5" placeholder="AI가 참고할 프로젝트 지침을 입력하세요">'+(editData?esc(editData.instructions||''):'')+'</textarea></div>'+
        '</div>';
    showModal(isEdit?'✏️ 프로젝트 수정':'📁 새 프로젝트',html,[
        {label:'취소'},
        {label:isEdit?'저장':'생성',cls:'primary',action:function(){
            var name=$('#proj-name-input').val().trim();
            if(!name){alert('프로젝트명을 입력해주세요');return}
            var payload={name:name,description:$('#proj-desc-input').val().trim(),instructions:$('#proj-instr-input').val().trim()};
            if(isEdit){
                $.ajax({url:apiUrl('/api/projects/'+editData._id),type:'PUT',contentType:'application/json',data:JSON.stringify(payload),success:function(){loadProjects(true);if(editData._id===_openProjectId)openProjectDetail(editData._id)}});
            } else {
                $.ajax({url:apiUrl('/api/projects'),type:'POST',contentType:'application/json',data:JSON.stringify(payload),success:function(r){loadProjects(true);openProjectDetail(r._id)}});
            }
        }}
    ]);
    setTimeout(function(){$('.proj-modal-input').css({width:'100%',padding:'8px 12px',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'13px',fontFamily:'var(--sans)',marginTop:'4px',outline:'none',background:'var(--white)'})},50);
}

function showProjectPages(mode){
    // mode: 'list' | 'detail' | 'hide'
    if(mode==='list'){
        $('#proj-page-list').show().css('display','flex').css('flex-direction','column');
        $('#proj-page-detail').hide();
        $('#messages,#input-area').hide();
    } else if(mode==='detail'){
        $('#proj-page-list').hide();
        $('#proj-page-detail').show().css('display','flex');
        $('#messages,#input-area').hide();
    } else {
        $('#proj-page-list,#proj-page-detail').hide();
        $('#messages,#input-area').show();
    }
}

var _openProjectId='';
var _projFilePath='.'; // 현재 프로젝트 파일 탐색 경로
function openProjectDetail(pid){
    _openProjectId=pid;
    _projFilePath='.';
    $.getJSON(apiUrl('/api/projects/'+pid),function(p){
        showProjectPages('detail');
        $('#proj-dt-name').text(p.name);
        $('#proj-dt-desc').text(p.description||'');
        $('#proj-dt-instr').html(p.instructions?'<div class="proj-instr-text">'+esc(p.instructions)+'</div>':'<div class="proj-empty-msg">지침을 추가하면 AI가 프로젝트에 맞게 응답합니다</div>');
        // 파일 (디스크 기반 탐색)
        loadProjectFileList(pid,'.');
        // 수정된 파일
        loadProjectOutputs(pid);
        // 대화 기록
        loadProjectChats(pid);
        // 활성화
        setActiveProject(pid, p.name);
    });
}

function loadProjectFileList(pid,subpath){
    _projFilePath=subpath||'.';
    // 브레드크럼 렌더링
    var $bc=$('#proj-file-breadcrumb').empty();
    var $root=$('<span class="pfbc-item pfbc-root" data-path=".">📁 루트</span>');
    $root.on('click',function(){loadProjectFileList(pid,'.')});
    $bc.append($root);
    if(subpath&&subpath!=='.'){
        var parts=subpath.split('/'),accum='';
        parts.forEach(function(part,i){
            accum=accum?accum+'/'+part:part;
            $bc.append('<span class="pfbc-sep">›</span>');
            if(i===parts.length-1){
                $bc.append('<span class="pfbc-item pfbc-current">'+esc(part)+'</span>');
            } else {
                var $seg=$('<span class="pfbc-item"></span>').text(part).data('p',accum);
                $seg.on('click',function(){loadProjectFileList(pid,$(this).data('p'))});
                $bc.append($seg);
            }
        });
    }
    // 파일 목록 API 호출
    $.getJSON(apiUrl('/api/projects/'+pid+'/files'),{subpath:subpath},function(d){
        var $fl=$('#proj-dt-files').empty();
        if(!d.items||!d.items.length){
            $fl.html('<div class="proj-empty-msg">파일이 없습니다</div>');return;
        }
        d.items.forEach(function(it){
            var diskPath='_projects/'+pid+'/'+it.rel_path;
            if(it.type==='directory'){
                var $dr=$('<div class="proj-dir-row"></div>').data('rp',it.rel_path);
                $dr.html('<span class="pdr-icon material-icons-outlined">folder</span>'+
                    '<span class="pdr-name" title="'+esc(it.name)+'">'+esc(it.name)+'</span>'+
                    '<span class="pdr-count">'+(it.child_count||0)+'개</span>'+
                    '<span class="pfr-acts"></span>');
                // 폴더 액션: zip 다운로드, 삭제
                var $da=$dr.find('.pfr-acts');
                $('<button class="pfr-abtn" title="zip 다운로드">📦</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.location.href=apiUrlO('/api/download-folder?path='+encodeURIComponent($(this).data('p')))}).appendTo($da);
                $('<button class="pfr-abtn del" title="삭제">✕</button>').data('rp',it.rel_path).on('click',function(e){
                    e.stopPropagation();
                    showModal('폴더 삭제','<code>'+esc(it.name)+'</code> 폴더를 삭제하시겠습니까?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){
                        $.ajax({url:apiUrl('/api/projects/'+pid+'/files/'+encodeURIComponent(it.rel_path)),type:'DELETE',success:function(){loadProjectFileList(pid,_projFilePath)}});
                    }}]);
                }).appendTo($da);
                $dr.on('click',function(e){
                    if($(e.target).closest('.pfr-acts').length)return;
                    loadProjectFileList(pid,$(this).data('rp'));
                });
                $fl.append($dr);
            } else {
                var ext=(it.name.split('.').pop()||'').toLowerCase();
                var $fr=$('<div class="proj-file-row"></div>');
                $fr.html('<span class="pfr-icon">'+(FILE_ICONS[ext]||'📄')+'</span>'+
                    '<div class="pfr-info"><div class="pfr-name" title="'+esc(it.name)+'">'+esc(it.name)+'</div><div class="pfr-size">'+fmtSize(it.size||0)+'</div></div>'+
                    '<span class="pfr-ext">'+ext.toUpperCase()+'</span>'+
                    '<span class="pfr-acts"></span>');
                var $fa=$fr.find('.pfr-acts');
                // 다운로드
                $('<button class="pfr-abtn" title="다운로드">⬇</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.location.href=apiUrlO('/api/download?path='+encodeURIComponent($(this).data('p')))}).appendTo($fa);
                // 미리보기 (html,css,js,json,md,txt,xml,svg,csv,yaml,py,java,ts,jsx,tsx,sql,log,ini,cfg,conf,env,png,jpg,jpeg,gif,webp,bmp,ico)
                if(/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env|gitignore|htaccess|png|jpg|jpeg|gif|webp|bmp|ico)$/.test(ext)){
                    $('<button class="pfr-abtn" title="미리보기">👁</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.open(previewUrl($(this).data('p')),'_blank')}).appendTo($fa);
                }
                // 편집 (텍스트 파일)
                if(/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env)$/.test(ext)){
                    $('<button class="pfr-abtn edit" title="편집">✏️</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.open(previewUrl($(this).data('p'))+(previewUrl($(this).data('p')).indexOf('?')>-1?'&':'?')+'edit=1','_blank')}).appendTo($fa);
                }
                // 오피스 뷰어 (pptx,xlsx,docx,pdf,hwp 등)
                if(/^(pptx?|xlsx?|docx?|pdf|hwp|hwpx|cell|show|txt|csv)$/.test(ext)){
                    $('<button class="pfr-abtn" title="문서 뷰어" style="color:var(--blue)">📄</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();openOfficeViewer($(this).data('p'))}).appendTo($fa);
                }
                // 삭제
                $('<button class="pfr-abtn del" title="삭제">✕</button>').data('rp',it.rel_path).data('n',it.name).on('click',function(e){
                    e.stopPropagation();
                    var rp=$(this).data('rp'),n=$(this).data('n');
                    showModal('파일 삭제','<code>'+esc(n)+'</code> 파일을 삭제하시겠습니까?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){
                        $.ajax({url:apiUrl('/api/projects/'+pid+'/files/'+encodeURIComponent(rp)),type:'DELETE',success:function(){loadProjectFileList(pid,_projFilePath)}});
                    }}]);
                }).appendTo($fa);
                $fl.append($fr);
            }
        });
    });
}

function loadProjectOutputs(pid){
    $.getJSON(apiUrl('/api/projects/'+pid+'/snapshots'),function(d){
        var $c=$('#proj-dt-outputs').empty();
        if(!d.snapshots||!d.snapshots.length){
            $c.html('<div class="proj-empty-msg">파일이 수정되면 수정 전 원본이 자동 백업됩니다<br><span style="font-size:10px;color:var(--tx3)">최근 5개 버전만 보관됩니다</span></div>');
            return;
        }
        d.snapshots.forEach(function(sn){
            var $sg=$('<div class="proj-snap-group"></div>');
            var $hd=$('<div class="proj-snap-hd"></div>');
            $hd.html('<span class="material-icons-outlined" style="font-size:16px;color:var(--blue)">history</span>'+
                '<span class="psh-label">'+esc(sn.folder_key)+'</span>'+
                '<span class="psh-count">'+sn.file_count+'개 · '+fmtSize(sn.total_size||0)+'</span>'+
                '<button class="pfr-abtn psa-restore" title="이 버전으로 복원" style="color:#059669">🔄</button>'+
                '<button class="pfr-abtn psa-zip" title="zip 다운로드">📦</button>'+
                '<button class="pfr-abtn del" title="삭제">✕</button>');
            $hd.find('.psa-restore').on('click',function(e){
                e.stopPropagation();
                showModal('버전 복원','<b>'+esc(sn.folder_key)+'</b> 시점으로 프로젝트 파일을 복원하시겠습니까?<br><span style="font-size:11px;color:#dc2626">현재 파일이 이 버전으로 교체됩니다.</span>',[{label:'취소'},{label:'복원',cls:'danger',action:function(){
                    $.ajax({url:apiUrl('/api/projects/'+pid+'/snapshots/'+encodeURIComponent(sn.folder_key)+'/restore'),type:'POST',contentType:'application/json',data:'{}',
                        success:function(){showModal('복원 완료','프로젝트가 <b>'+esc(sn.folder_key)+'</b> 버전으로 복원되었습니다.',[{label:'확인'}]);loadProjectFileList(pid,'.');},
                        error:function(){alert('복원 실패')}});
                }}]);
            });
            $hd.find('.psa-zip').on('click',function(e){
                e.stopPropagation();
                window.location.href=apiUrl('/api/projects/'+pid+'/snapshots/'+encodeURIComponent(sn.folder_key)+'/download');
            });
            $hd.find('.pfr-abtn.del').on('click',function(e){
                e.stopPropagation();
                showModal('버전 삭제','<code>'+esc(sn.folder_key)+'</code> 버전을 삭제하시겠습니까?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){
                    $.ajax({url:apiUrl('/api/projects/'+pid+'/snapshots/'+encodeURIComponent(sn.folder_key)),type:'DELETE',success:function(){loadProjectOutputs(pid)}});
                }}]);
            });
            // 스냅샷 내 파일 목록 (클릭 시 로드)
            var $body=$('<div class="proj-snap-body"></div>');
            $body.html('<div class="proj-empty-msg" style="cursor:pointer;padding:6px" onclick="loadSnapFiles(\''+pid+'\',\''+sn.folder_key+'\',\'.\',$(this).parent())">클릭하여 파일 목록 보기</div>');
            $hd.on('click',function(){$body.toggle();$(this).toggleClass('open')});
            $sg.append($hd).append($body);
            if($c.children('.proj-snap-group').length===0){$hd.addClass('open');$body.show()}
            $c.append($sg);
        });
        $c.append('<div style="font-size:10px;color:var(--tx3);text-align:center;padding:8px 0;border-top:1px solid var(--border-lt);margin-top:4px">최근 5개 버전만 보관됩니다</div>');
    });
}
function loadSnapFiles(pid,folderKey,subpath,$body){
    $.getJSON(apiUrl('/api/projects/'+pid+'/snapshots/'+encodeURIComponent(folderKey)+'/files'),{subpath:subpath},function(d){
        $body.empty();
        if(subpath&&subpath!=='.'){
            var parent=subpath.split('/').slice(0,-1).join('/')||'.';
            $body.append('<div class="proj-dir-row" style="cursor:pointer;color:var(--blue)" onclick="loadSnapFiles(\''+pid+'\',\''+folderKey+'\',\''+parent+'\',$(this).parent())">📁 ..</div>');
        }
        if(!d.items||!d.items.length){$body.html('<div class="proj-empty-msg">파일 없음</div>');return}
        d.items.forEach(function(it){
            // _로 시작하는 폴더 숨김
            if(it.name.charAt(0)==='_') return;
            if(it.type==='directory'){
                var newPath=subpath&&subpath!=='.'?subpath+'/'+it.name:it.name;
                $body.append('<div class="proj-dir-row" style="cursor:pointer" onclick="loadSnapFiles(\''+pid+'\',\''+folderKey+'\',\''+newPath+'\',$(this).parent())"><span>📁</span> '+esc(it.name)+' <span class="psh-count">'+it.children+'개</span></div>');
            } else {
                var ext=(it.name.split('.').pop()||'').toLowerCase();
                var diskPath=it.path;
                var $fr=$('<div class="proj-file-row"></div>');
                $fr.html('<span class="pfr-icon">'+(FILE_ICONS[ext]||'📝')+'</span>'+
                    '<div class="pfr-info"><div class="pfr-name" title="'+esc(it.name)+'">'+esc(it.name)+'</div>'+
                    '<div class="pfr-size">'+fmtSize(it.size||0)+'</div></div>'+
                    '<span class="pfr-acts"></span>');
                var $fa=$fr.find('.pfr-acts');
                // 다운로드
                $('<button class="pfr-abtn" title="다운로드">⬇</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.location.href=apiUrlO('/api/download?path='+encodeURIComponent($(this).data('p')))}).appendTo($fa);
                // 미리보기
                if(/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env|gitignore|htaccess|png|jpg|jpeg|gif|webp|bmp|ico)$/.test(ext)){
                    $('<button class="pfr-abtn" title="미리보기">👁</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.open(previewUrl($(this).data('p')),'_blank')}).appendTo($fa);
                }
                // 편집
                if(/^(html?|css|js|json|md|txt|xml|svg|csv|ya?ml|sh|py|java|ts|jsx|tsx|sql|log|ini|cfg|conf|env)$/.test(ext)){
                    $('<button class="pfr-abtn edit" title="편집">✏️</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();window.open(previewUrl($(this).data('p'))+(previewUrl($(this).data('p')).indexOf('?')>-1?'&':'?')+'edit=1','_blank')}).appendTo($fa);
                }
                // 오피스 뷰어
                if(/^(pptx?|xlsx?|docx?|pdf|hwp|hwpx|cell|show|txt|csv)$/.test(ext)){
                    $('<button class="pfr-abtn" title="문서 뷰어" style="color:var(--blue)">📄</button>').data('p',diskPath).on('click',function(e){e.stopPropagation();openOfficeViewer($(this).data('p'))}).appendTo($fa);
                }
                $body.append($fr);
            }
        });
    });
}


var _projChatState={skip:0,total:0,loading:false,page:1};
function loadProjectChats(pid,reset){
    if(reset===undefined) reset=true;
    if(_projChatState.loading) return;
    if(reset){
        _projChatState.skip=0;
        _projChatState.total=0;
        _projChatState.loading=false;
        _projChatState.page=1;
    }
    _projChatState.loading=true;
    var limit=10;
    var skip=(_projChatState.page-1)*limit;
    $.getJSON(apiUrl('/api/projects/'+pid+'/chats'),{skip:skip,limit:limit},function(d){
        _projChatState.total=d.total||0;
        var $c=$('#proj-dt-chats').empty();
        if(!d.logs||!d.logs.length){
            if(skip===0) $c.html('<div class="proj-empty-msg">대화를 시작하여 프로젝트 지식을 재사용하세요</div>');
            _projChatState.loading=false;
            return;
        }
        d.logs.forEach(function(log){
            var dt=log.updated_at?timeAgo(log.updated_at):'';
            var $cr=$('<div class="proj-chat-row"></div>').data('sid',log.session_id);
            $cr.html('<input type="checkbox" class="pcr-check" style="display:none">'+
                '<span class="material-icons-outlined" style="font-size:18px;color:var(--tx3)">chat_bubble_outline</span>'+
                '<span class="pcr-title" title="'+esc(log.title||'')+'">'+esc(log.title||'(제목 없음)')+'</span>'+
                '<span class="pcr-date">'+dt+'</span>');
            $cr.on('click',function(e){
                if(_projChatSelectMode){
                    var $cb=$(this).find('.pcr-check');
                    $cb.prop('checked',!$cb.prop('checked'));
                    $(this).toggleClass('selected',$cb.prop('checked'));
                    _updateProjChatDelBtn();
                    return;
                }
                var sid=$(this).data('sid');
                showProjectPages('hide');
                ws.send(JSON.stringify({type:'load_session',session_id:sid}));
                currentSessionId=sid;
                setActiveProject(pid,$('#proj-dt-name').text());
            });
            $c.append($cr);
        });
        // 페이징 컨트롤
        var totalPages=Math.ceil(_projChatState.total/limit);
        if(totalPages>1){
            var $pg=$('<div class="proj-chat-paging"></div>');
            if(_projChatState.page>1){
                $('<button class="proj-pg-btn">◀ 이전</button>').on('click',function(){
                    _projChatState.page--;loadProjectChats(pid,false);
                }).appendTo($pg);
            }
            $pg.append('<span class="proj-pg-info">'+_projChatState.page+' / '+totalPages+'</span>');
            if(_projChatState.page<totalPages){
                $('<button class="proj-pg-btn">다음 ▶</button>').on('click',function(){
                    _projChatState.page++;loadProjectChats(pid,false);
                }).appendTo($pg);
            }
            $c.append($pg);
        }
        _projChatState.loading=false;
    }).fail(function(){_projChatState.loading=false});
}

var _projChatSelectMode=false;
function _toggleProjChatSelect(on){
    _projChatSelectMode=on;
    if(on){
        $('#btn-proj-chat-select').hide();
        $('#btn-proj-chat-delall,#btn-proj-chat-delsel,#btn-proj-chat-cancel').show();
        $('#proj-dt-chats .proj-chat-row').addClass('selectable').find('.pcr-check').show();
    } else {
        $('#btn-proj-chat-select').show();
        $('#btn-proj-chat-delall,#btn-proj-chat-delsel,#btn-proj-chat-cancel').hide();
        $('#proj-dt-chats .proj-chat-row').removeClass('selectable selected').find('.pcr-check').prop('checked',false).hide();
    }
    _updateProjChatDelBtn();
}
function _updateProjChatDelBtn(){
    var cnt=$('#proj-dt-chats .pcr-check:checked').length;
    $('#btn-proj-chat-delsel').text(cnt?cnt+'개 삭제':'삭제').prop('disabled',!cnt);
}

function setActiveProject(pid,name){
    activeProjectId=pid||'';
    activeProjectName=name||'';
    $('#project-badge').remove();
    if(!pid)return;
    var $badge=$('<div id="project-badge"><span style="font-size:14px">📁</span><span class="pb-name" title="프로젝트 설정으로 이동">'+esc(name)+'</span><span class="pb-x" title="프로젝트 해제">✕</span></div>');
    $badge.find('.pb-name').css('cursor','pointer').on('click',function(){
        switchLeftTab('project');
        openProjectDetail(activeProjectId);
    });
    $badge.find('.pb-x').on('click',function(e){e.stopPropagation();activeProjectId='';activeProjectName='';$('#project-badge').remove()});
    var $sm=$('#skill-mention');
    if($sm.length) $sm.before($badge); else $('.input-wrap').before($badge);
}

var restTaskState={skip:0,total:0};

function loadRestTasks(reset){
    if(reset===true||restTaskState.skip===0){
        restTaskState.skip=0;
        restTaskState.total=0;
        $('#rest-task-list').empty();
    }
    var limit=(restTaskState.skip===0)?INITIAL_PAGE:MORE_PAGE;
    $.getJSON(apiUrl('/api/tasks'),{skip:restTaskState.skip,limit:limit},function(d){
        restTaskState.total=d.total||0;
        var $l=$('#rest-task-list');
        $l.find('.log-more-btn').remove();
        $l.find('.log-empty').remove();
        if(!d.tasks||!d.tasks.length){
            if(restTaskState.skip===0)$l.append('<div class="log-empty"><span class="material-icons-outlined">api</span>스케줄 작업이 없습니다</div>');
            return;
        }
        $.each(d.tasks,function(i,t){
            var dt=t.started_at?t.started_at.substring(0,19).replace('T',' '):'';
            var statusCls=t.status||'unknown';
            var statusLabels={running:'실행중',done:'완료',error:'오류',cancelled:'취소'};
            var $it=$('<div class="rest-item"></div>').data('tid',t.task_id).data('task',t);
            $it.html(
                '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'+
                '<span class="rest-status '+statusCls+'">'+(statusLabels[statusCls]||statusCls)+'</span>'+
                '<div class="log-title" style="flex:1;font-size:12px" title="'+esc(t.message||'')+'">'+esc(t.message||'(내용 없음)')+'</div>'+
                '</div>'+
                '<div class="log-meta"><span>'+dt+'</span>'+(t.duration_seconds?'<span>'+t.duration_seconds.toFixed(1)+'초</span>':'')+'</div>'
            );
            $it.on('click',function(){showRestTaskDetail($(this).data('tid'))});
            $l.append($it);
        });
        restTaskState.skip+=d.tasks.length;
        if(restTaskState.skip<restTaskState.total){
            var remaining=restTaskState.total-restTaskState.skip;
            var $more=$('<div class="log-more-btn"><span class="material-icons-outlined">expand_more</span> 더보기 <span class="log-count-badge">'+remaining+'건 남음</span></div>');
            $more.on('click',function(){
                $(this).html('<span class="material-icons-outlined" style="animation:tcSpin .7s linear infinite">refresh</span> 불러오는 중...');
                loadRestTasks(false);
            });
            $l.append($more);
        }
    });
}

function showRestTaskDetail(taskId){
    var html='<div id="rest-detail-status" style="margin-bottom:10px"><span class="rest-status running">로딩...</span></div>'+
        '<div id="rest-log-viewer" class="rest-log-viewer">로그를 불러오는 중...</div>'+
        '<div style="margin-top:10px;font-size:11px;color:var(--tx3)" id="rest-auto-refresh">🔄 자동 갱신 중...</div>';
    showModal('📋 작업 상세 로그',html,[
        {label:'새로고침',action:function(){fetchRestLogs(taskId,true)}},
        {label:'취소',cls:'danger',action:function(){cancelRestTask(taskId)}},
        {label:'닫기'}
    ]);
    fetchRestLogs(taskId,true);
    // 자동 폴링 (실행 중이면 2초마다)
    if(restPollingTimers[taskId])clearInterval(restPollingTimers[taskId]);
    restPollingTimers[taskId]=setInterval(function(){
        var $v=$('#rest-log-viewer');
        if(!$v.length){clearInterval(restPollingTimers[taskId]);delete restPollingTimers[taskId];return}
        fetchRestLogs(taskId,false);
    },2000);
}

function fetchRestLogs(taskId, full){
    $.getJSON(apiUrl('/api/task/'+taskId+'/logs')+(full?'':'?since='+($('#rest-log-viewer').data('count')||0)),function(d){
        var $v=$('#rest-log-viewer');if(!$v.length)return;
        var statusLabels={running:'실행중',done:'완료',error:'오류',cancelled:'취소',unknown:'알 수 없음'};
        $('#rest-detail-status').html('<span class="rest-status '+(d.status||'unknown')+'">'+(statusLabels[d.status]||d.status)+'</span> <span style="font-size:11px;color:var(--tx3)">총 로그: '+d.total_logs+'건</span>');
        if(full){$v.empty();$v.data('count',0)}
        $.each(d.logs,function(i,log){
            var time=log.timestamp?log.timestamp.substring(11,19):'';
            var typeLabels={info:'INFO',error:'ERROR',progress:'STEP',text:'TEXT',tool_start:'TOOL',tool_executing:'EXEC',tool_result:'RESULT',done:'DONE',complete:'✓',warning:'WARN',cancelled:'CANCEL'};
            $v.append('<div class="rest-log-entry '+(log.type||'')+'"><span class="rest-log-time">'+time+'</span><span class="rest-log-type">'+(typeLabels[log.type]||log.type)+'</span><span class="rest-log-content">'+esc(log.content||'')+'</span></div>');
        });
        $v.data('count',d.total_logs);
        $v.scrollTop($v[0].scrollHeight);
        // 완료되면 폴링 중지
        if(d.status==='done'||d.status==='error'||d.status==='cancelled'){
            if(restPollingTimers[taskId]){clearInterval(restPollingTimers[taskId]);delete restPollingTimers[taskId]}
            $('#rest-auto-refresh').text('✅ 작업이 완료되었습니다');
            if(currentLeftTab==='rest')loadRestTasks(true);
        }
    });
}

function cancelRestTask(taskId){
    $.ajax({url:apiUrl('/api/task/'+taskId+'/cancel'),type:'POST',contentType:'application/json',data:'{}',success:function(r){
        if(r.status==='cancelled'){showRestTaskDetail(taskId)}
    }});
}

function submitRestTask(){
    showModal('🚀 REST API 작업 실행',
        '<div style="margin-bottom:10px;font-size:12px;color:var(--tx2)">WebSocket 없이 백그라운드에서 실행됩니다. 로그가 자동 저장됩니다.</div>'+
        '<textarea class="modal-input" id="rest-msg" placeholder="작업 내용을 입력하세요" rows="3" style="resize:vertical;min-height:60px"></textarea>'+
        '작업 폴더 (기본: 현재 폴더)' + 
		'<input class="modal-input" id="rest-folder" placeholder="작업 폴더 (기본: 현재 폴더)" value="'+esc(currentPath)+'">',
    [{label:'취소'},{label:'실행',cls:'primary',action:function(){
        var msg=$.trim($('#rest-msg').val()),folder=$.trim($('#rest-folder').val())||'.';
        if(!msg)return;
        $.ajax({url:apiUrl('/api/task'),type:'POST',contentType:'application/json',data:JSON.stringify({message:msg,currentFolder:folder}),
            success:function(r){
                switchLeftTab('rest');
                showRestTaskDetail(r.task_id);
            },error:function(x){alert(x.responseJSON?.detail||'오류')}
        });
    }}]);
    setTimeout(function(){$('#rest-msg').focus()},100);
}

// ================================================================
// Init - JWT 인증 정보 조회
// ================================================================
$(function(){
    // JWT 사용자 정보 조회
    if(pathToken){
        $.getJSON(apiUrl('/api/auth-info'),function(d){
            if(d.authenticated && d.username){
                currentUser=d.username;
                // 관리자 권한 확인
                if(d.role==='admin'){
                    window._isAdmin=true;
                }
                // 조직도에서 이름/부서 조회하여 배지 표시
                $.getJSON(apiUrl('/api/org/user'),{lid:currentUser},function(r){
                    if(r.found){
                        $('#user-badge').text(r.name+' '+r.dept).data('resolved',true).show();
                    } else {
                        $('#user-badge').text(currentUser).show();
                    }
                    // 관리자 버튼을 사용자 배지 바로 뒤에 배치
                    if(window._isAdmin){$('#btn-admin').show()}
                }).fail(function(){
                    $('#user-badge').text(currentUser).show();
                    if(window._isAdmin){$('#btn-admin').show()}
                });
            }
        });
    }
    connectWS();refreshFiles();marked.setOptions({breaks:true,gfm:true});
    // 좌측 패널 리사이즈
    (function(){
        var handle=$('#lp-resize-handle')[0], dragging=false, startX, startW;
        handle.addEventListener('mousedown',function(e){
            dragging=true; startX=e.clientX;
            startW=$('#left-panel').outerWidth();
            handle.classList.add('active');
            document.body.style.cursor='col-resize';
            document.body.style.userSelect='none';
            e.preventDefault();
        });
        document.addEventListener('mousemove',function(e){
            if(!dragging)return;
            var newW=Math.max(180,Math.min(500, startW+(e.clientX-startX)));
            document.getElementById('app').style.setProperty('--lp-width', newW+'px');
        });
        document.addEventListener('mouseup',function(){
            if(!dragging)return;
            dragging=false;
            handle.classList.remove('active');
            document.body.style.cursor='';
            document.body.style.userSelect='';
        });
    })();
    // 우측 패널 리사이즈
    (function(){
        var handle=$('#rp-resize-handle')[0], dragging=false, startX, startW;
        handle.addEventListener('mousedown',function(e){
            dragging=true; startX=e.clientX;
            startW=$('#right-panel').outerWidth();
            handle.classList.add('active');
            document.body.style.cursor='col-resize';
            document.body.style.userSelect='none';
            e.preventDefault();
        });
        document.addEventListener('mousemove',function(e){
            if(!dragging)return;
            var newW=Math.max(200,Math.min(800, startW+(startX-e.clientX)));
            document.getElementById('app').style.setProperty('--rp-width', newW+'px');
        });
        document.addEventListener('mouseup',function(){
            if(!dragging)return;
            dragging=false;
            handle.classList.remove('active');
            document.body.style.cursor='';
            document.body.style.userSelect='';
        });
    })();
    $('#msg-input').on('keydown',function(e){
        // 슬래시 팝업 키보드 제어
        if(handleSlashKey(e)) return;
        // 기본 Enter 전송
        if(e.key==='Enter'&&!e.shiftKey&&!(e.originalEvent&&e.originalEvent.isComposing)){e.preventDefault();sendMessage()}
    }).on('input',function(){autoResize(this);checkSlashTrigger()}).on('focus',function(){$(this).closest('.input-wrap').addClass('focus')}).on('blur',function(){$(this).closest('.input-wrap').removeClass('focus');setTimeout(function(){if(isSlashOpen())hideSlashPopup()},200)});

    // 클립보드 붙여넣기 (이미지 등)
    $('#msg-input').on('paste',function(e){
        var items=(e.originalEvent.clipboardData||{}).items;
        if(!items)return;
        for(var i=0;i<items.length;i++){
            if(items[i].kind==='file'){
                e.preventDefault();
                var f=items[i].getAsFile();
                if(f){
                    // 클립보드 이미지는 이름이 없으므로 생성
                    if(!f.name||f.name==='image.png'){
                        var ts=new Date().toISOString().replace(/[:.]/g,'-').substring(0,19);
                        var ext=f.type?f.type.split('/')[1]||'png':'png';
                        f=new File([f],'clipboard_'+ts+'.'+ext,{type:f.type});
                    }
                    addAttachment(f);
                }
            }
        }
    });

    // 드래그&드롭 (input-wrap 영역)
    var $inputWrap=$('.input-wrap');
    $inputWrap.on('dragover',function(e){e.preventDefault();e.stopPropagation();$(this).addClass('drag-over')});
    $inputWrap.on('dragleave',function(e){e.preventDefault();e.stopPropagation();$(this).removeClass('drag-over')});
    $inputWrap.on('drop',function(e){
        e.preventDefault();e.stopPropagation();$(this).removeClass('drag-over');
        var files=e.originalEvent.dataTransfer.files;
        if(files&&files.length){for(var i=0;i<files.length;i++) addAttachment(files[i])}
    });

    // 첨부 버튼 클릭
    $('#attach-btn').on('click',function(){$('#attach-file-input').click()});
    $('#attach-file-input').on('change',function(){
        var files=this.files;
        if(files&&files.length){for(var i=0;i<files.length;i++) addAttachment(files[i])}
        $(this).val('');
    });

    $('#send-btn').on('click',sendMessage);
    $('#stop-btn').on('click',function(){
        if(ws&&ws.readyState===1){ws.send(JSON.stringify({type:'cancel'}))}
        // 즉시 UI 정리 (서버 응답 전에 사용자에게 피드백)
        showGlobalProgress(T('progress_stop_request','⏹ 작업 중지 요청 중...'));
        if($currentBubble){
            $currentBubble.find('.streaming-cursor').remove();
            $currentBubble.find('#streaming-status').remove();
            $currentBubble.find('.streaming-status').remove();
        }
        removeProgress();hideWorking();
    });
    $(document).on('click','.wc-card',function(){$('#msg-input').val($(this).find('.wc-card-text').text());sendMessage()});
    $('#btn-refresh-logs').on('click',function(){if(currentLeftTab==='chat')loadChatLogs(true);else loadRestTasks(true)});
    // 프로젝트 대화 목록 무한 스크롤
    function bindProjChatScroll(){
        $('#proj-dt-chats').off('scroll.inf').on('scroll.inf',function(){
            var el=this;
            if(el.scrollTop+el.clientHeight>=el.scrollHeight-30){
                if(!_projChatState.loading && _projChatState.skip<_projChatState.total) loadProjectChats(_openProjectId,false);
            }
        });
    }
    $(document).on('click','.lp-tab-btn',function(){switchLeftTab($(this).data('tab'))});
    $('#btn-upload').on('click',function(){$('#file-input').click()});$('#file-input').on('change',function(){uploadFiles(this.files);$(this).val('')});
    $('#btn-upload-folder').on('click',function(){$('#folder-input').click()});$('#folder-input').on('change',function(){uploadFolder(this.files);$(this).val('')});
    $('#btn-new-folder').on('click',createFolder);$('#btn-delete-all').on('click',deleteAllFiles);
    $('#btn-dl-folder').on('click',function(){window.location.href=apiUrlO('/api/download-folder?path='+encodeURIComponent(currentPath))});
    $('#btn-refresh-files').on('click',function(){if(currentRpTab==='files')refreshFiles();else loadShares()});
    $(document).on('click','.rp-tabs .rp-tab[data-rptab]',function(){switchRpTab($(this).data('rptab'))});
    $('#btn-move-here').on('click',function(){if(selectedFiles.length)moveItems(selectedFiles,currentPath)});
    $('#btn-move-cancel').on('click',function(){selectedFiles=[];updateMoveBar();$('#file-list .fi').removeClass('selected')});
    $('#btn-new-chat').on('click',function(){
        showModal('새 대화','새 대화를 시작하시겠습니까?',[{label:'취소'},{label:'새 대화',cls:'primary',action:function(){
            // 프로젝트 해제
            activeProjectId='';activeProjectName='';$('#project-badge').remove();
            // 프로젝트 페이지 숨기고 대화 화면으로
            showProjectPages('hide');
            switchLeftTab('chat');
            // 파일 패널 루트로
            currentPath='.';refreshFiles();
            // 대화 초기화 (웰컴 화면 표시됨)
            if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'clear'}));
        }}]);
    });
    // 타이틀 클릭 → 초기화면
    $('.hdr-logo').css('cursor','pointer').on('click',function(){
        showProjectPages('hide');
        switchLeftTab('chat');
        if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'clear'}));
    });
    $('#btn-figma,#chip-figma').on('click',showFigmaModal);
    $('#btn-infographic,#chip-infographic').on('click',showInfographicModal);
    $('#btn-slidedeck,#chip-slidedeck').on('click',showSlideDeckModal);
    $('#btn-settings').on('click',showSettingsModal);
    $('#btn-admin').on('click',function(){
        window.open(apiUrl('/api/admin/dashboard'),'_blank');
    });
    // 프로젝트 이벤트
    $('#btn-new-project').on('click',function(){showProjectCreateModal()});
    $('#btn-proj-back').on('click',function(){showProjectPages('list');loadProjects(true)});
    $('#btn-proj-edit').on('click',function(){
        if(!_openProjectId)return;
        $.getJSON(apiUrl('/api/projects/'+_openProjectId),function(p){showProjectCreateModal(p)});
    });
    $('#btn-proj-delete').on('click',function(){
        if(!_openProjectId)return;
        showModal('프로젝트 삭제','이 프로젝트를 삭제하시겠습니까?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){
            $.ajax({url:apiUrl('/api/projects/'+_openProjectId),type:'DELETE',success:function(){
                if(activeProjectId===_openProjectId){activeProjectId='';activeProjectName='';$('#project-badge').remove()}
                _openProjectId='';showProjectPages('list');loadProjects(true);
            }});
        }}]);
    });
    $('#btn-proj-instr-edit').on('click',function(){
        if(!_openProjectId)return;
        $.getJSON(apiUrl('/api/projects/'+_openProjectId),function(p){
            showModal('📋 지침 편집','<textarea id="proj-instr-edit-ta" style="width:100%;min-height:150px;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:var(--sans);resize:vertical">'+esc(p.instructions||'')+'</textarea>',[
                {label:'취소'},
                {label:'저장',cls:'primary',action:function(){
                    $.ajax({url:apiUrl('/api/projects/'+_openProjectId),type:'PUT',contentType:'application/json',data:JSON.stringify({instructions:$('#proj-instr-edit-ta').val()}),success:function(){openProjectDetail(_openProjectId)}});
                }}
            ]);
        });
    });
    $('#btn-proj-file-add').on('click',function(){$('#proj-file-input').click()});
    $('#btn-proj-folder-add').on('click',function(){$('#proj-folder-input').click()});
    // 새폴더 생성
    $('#btn-proj-mkdir').on('click',function(){
        if(!_openProjectId)return;
        showModal('📁 새 폴더','<input id="proj-mkdir-input" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:var(--sans);outline:none" placeholder="폴더 이름">',[
            {label:'취소'},
            {label:'생성',cls:'primary',action:function(){
                var name=$('#proj-mkdir-input').val().trim();
                if(!name)return;
                $.ajax({url:apiUrl('/api/projects/'+_openProjectId+'/mkdir'),type:'POST',contentType:'application/json',
                    data:JSON.stringify({name:name,subpath:_projFilePath}),
                    success:function(){loadProjectFileList(_openProjectId,_projFilePath)}
                });
            }}
        ]);
    });
    // 멀티 파일 업로드 (현재 경로 포함)
    function uploadProjectFiles(fileList){
        if(!_openProjectId||!fileList.length)return;
        var fd=new FormData();
        for(var i=0;i<fileList.length;i++) fd.append('files',fileList[i]);
        fd.append('subpath',_projFilePath);
        var $drop=$('#proj-file-drop');
        $drop.html('<span class="material-icons-outlined" style="font-size:16px">hourglass_top</span> 업로드 중... ('+fileList.length+'개)').addClass('drag-over');
        $.ajax({url:apiUrl('/api/projects/'+_openProjectId+'/files'),type:'POST',data:fd,processData:false,contentType:false,
            success:function(){loadProjectFileList(_openProjectId,_projFilePath);resetDropzone()},
            error:function(){alert('업로드 실패');resetDropzone()}
        });
    }
    function resetDropzone(){$('#proj-file-drop').html('<span class="material-icons-outlined" style="font-size:20px">cloud_upload</span><br>파일 또는 폴더를 드래그하세요').removeClass('drag-over')}
    $('#proj-file-input').on('change',function(){uploadProjectFiles(this.files);$(this).val('')});
    $('#proj-folder-input').on('change',function(){uploadProjectFiles(this.files);$(this).val('')});
    // 드래그&드롭 (파일+폴더, 구조 보존)
    $(document).on('dragover','#proj-file-drop,#proj-files-card,#proj-dt-files',function(e){e.preventDefault();e.stopPropagation();$('#proj-file-drop').addClass('drag-over')});
    $(document).on('dragleave','#proj-file-drop',function(e){e.preventDefault();$('#proj-file-drop').removeClass('drag-over')});
    $(document).on('drop','#proj-file-drop,#proj-files-card,#proj-dt-files',function(e){
        e.preventDefault();e.stopPropagation();$('#proj-file-drop').removeClass('drag-over');
        if(!_openProjectId)return;
        var dt=e.originalEvent.dataTransfer;
        if(!dt) return;
        // 1) 파일 탐색기에서 드래그 (application/json 경로 배열)
        var jsonData=dt.getData('application/json');
        if(jsonData){
            try{
                var paths=JSON.parse(jsonData);
                if(Array.isArray(paths)&&paths.length){
                    var $drop=$('#proj-file-drop');
                    $drop.html('<span class="material-icons-outlined" style="font-size:16px">hourglass_top</span> 복사 중... ('+paths.length+'개)').addClass('drag-over');
                    $.ajax({url:apiUrl('/api/projects/'+_openProjectId+'/copy-from-workspace'),type:'POST',contentType:'application/json',
                        data:JSON.stringify({items:paths,subpath:_projFilePath,owner:shareMode?shareMode.owner:undefined}),
                        success:function(r){loadProjectFileList(_openProjectId,_projFilePath);resetDropzone()},
                        error:function(){alert('복사 실패');resetDropzone()}
                    });
                    return;
                }
            }catch(ex){}
        }
        // 2) OS 파일/폴더 드래그 (FileSystemEntry API)
        if(!dt.items) return;
        var items=dt.items,entries=[];
        for(var i=0;i<items.length;i++){
            var entry=items[i].webkitGetAsEntry?items[i].webkitGetAsEntry():null;
            if(entry) entries.push(entry);
        }
        if(entries.length){
            collectAllFilesWithPath(entries,'').then(function(fileArr){
                if(!fileArr.length)return;
                var fd=new FormData();
                fileArr.forEach(function(item){
                    var f=new File([item.file],item.relPath,{type:item.file.type,lastModified:item.file.lastModified});
                    fd.append('files',f);
                });
                fd.append('subpath',_projFilePath);
                var $drop=$('#proj-file-drop');
                $drop.html('<span class="material-icons-outlined" style="font-size:16px">hourglass_top</span> 업로드 중... ('+fileArr.length+'개)').addClass('drag-over');
                $.ajax({url:apiUrl('/api/projects/'+_openProjectId+'/files'),type:'POST',data:fd,processData:false,contentType:false,
                    success:function(){loadProjectFileList(_openProjectId,_projFilePath);resetDropzone()},
                    error:function(){alert('업로드 실패');resetDropzone()}
                });
            });
        } else if(dt.files&&dt.files.length){
            uploadProjectFiles(dt.files);
        }
    });
    $(document).on('click','#proj-file-drop',function(){$('#proj-file-input').click()});
    // 재귀 파일 수집 (경로 보존)
    function collectAllFilesWithPath(entries,basePath){
        return new Promise(function(resolve){
            var allFiles=[],pending=0;
            function processEntry(entry,currentPath){
                pending++;
                if(entry.isFile){
                    entry.file(function(f){
                        var relPath=currentPath?currentPath+'/'+f.name:f.name;
                        allFiles.push({file:f,relPath:relPath});
                        pending--;if(!pending)resolve(allFiles);
                    },function(){pending--;if(!pending)resolve(allFiles)});
                } else if(entry.isDirectory){
                    var dirPath=currentPath?currentPath+'/'+entry.name:entry.name;
                    var reader=entry.createReader();
                    (function readAll(reader,dirPath){
                        reader.readEntries(function(childEntries){
                            pending--;
                            if(childEntries.length){
                                childEntries.forEach(function(ce){processEntry(ce,dirPath)});
                                // Chrome은 100개씩 끊어서 반환하므로 재귀 호출
                                pending++;readAll(reader,dirPath);
                            }
                            if(!pending)resolve(allFiles);
                        },function(){pending--;if(!pending)resolve(allFiles)});
                    })(reader,dirPath);
                }
            }
            entries.forEach(function(e){processEntry(e,basePath)});
            if(!pending)resolve(allFiles);
        });
    }
    $('#btn-proj-outputs-refresh').on('click',function(){if(_openProjectId)loadProjectOutputs(_openProjectId)});
    // 프로젝트 검색
    $('#proj-search').on('input',function(){
        var q=$(this).val().toLowerCase();
        $('#proj-grid .proj-card').each(function(){
            var name=$(this).find('.proj-card-name').text().toLowerCase();
            var desc=$(this).find('.proj-card-desc').text().toLowerCase();
            $(this).toggle(name.indexOf(q)>-1||desc.indexOf(q)>-1);
        });
    });
    // 프로젝트 상세 > 새 대화
    $('#btn-proj-new-chat').on('click',function(){
        if(!_openProjectId)return;
        var pid=_openProjectId,pname=$('#proj-dt-name').text();
        showProjectPages('hide');
        switchLeftTab('chat');
        if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'clear'}));
        setTimeout(function(){setActiveProject(pid,pname)},300);
    });
    $('#btn-proj-chat-select').on('click',function(){_toggleProjChatSelect(true)});
    $('#btn-proj-chat-cancel').on('click',function(){_toggleProjChatSelect(false)});
    $('#btn-proj-chat-delsel').on('click',function(){
        var sids=[];
        $('#proj-dt-chats .pcr-check:checked').each(function(){sids.push($(this).closest('.proj-chat-row').data('sid'))});
        if(!sids.length) return;
        showModal('선택 삭제','<b>'+sids.length+'개</b> 대화를 삭제하시겠습니까?',[{label:'취소'},{label:'삭제',cls:'danger',action:function(){
            $.ajax({url:apiUrl('/api/projects/'+_openProjectId+'/chats/delete-selected'),type:'POST',contentType:'application/json',data:JSON.stringify({session_ids:sids}),
                success:function(){_toggleProjChatSelect(false);loadProjectChats(_openProjectId,true)}});
        }}]);
    });
    $('#btn-proj-chat-delall').on('click',function(){
        showModal('전체 삭제','이 프로젝트의 <b>모든 대화</b>를 삭제하시겠습니까?<br><span style="color:#dc2626;font-size:11px">이 작업은 되돌릴 수 없습니다.</span>',[{label:'취소'},{label:'전체 삭제',cls:'danger',action:function(){
            $.ajax({url:apiUrl('/api/projects/'+_openProjectId+'/chats'),type:'DELETE',
                success:function(){_toggleProjChatSelect(false);loadProjectChats(_openProjectId,true)}});
        }}]);
    });
    $('#btn-rest-task').on('click',submitRestTask);
    $('#file-list').on('dragover',function(e){e.preventDefault();$(this).css('background','var(--blue-lt)')}).on('dragleave',function(){$(this).css('background','')}).on('drop',function(e){
        e.preventDefault();$(this).css('background','');
        var dt=e.originalEvent.dataTransfer;
        if(!dt||!dt.items||!dt.items.length) return;
        // webkitGetAsEntry를 지원하면 폴더 구조 유지
        var items=dt.items;
        var hasDir=false;
        for(var k=0;k<items.length;k++){
            var entry=items[k].webkitGetAsEntry&&items[k].webkitGetAsEntry();
            if(entry&&entry.isDirectory){hasDir=true;break}
        }
        if(hasDir||items.length>0&&items[0].webkitGetAsEntry){
            // 폴더 포함 또는 Entry API 지원 → 재귀 탐색
            collectDropEntries(items,function(fileList){
                if(fileList.length) uploadDroppedFiles(fileList);
            });
        } else if(dt.files.length){
            uploadFiles(dt.files);
        }
    });

    // 드래그&드롭: Entry API로 폴더 구조 재귀 수집
    function collectDropEntries(items,callback){
        var entries=[];
        for(var i=0;i<items.length;i++){
            var entry=items[i].webkitGetAsEntry?items[i].webkitGetAsEntry():null;
            if(entry) entries.push(entry);
        }
        if(!entries.length){callback([]);return}
        var result=[];
        var pending=0;
        function readEntry(entry,pathPrefix){
            if(entry.isFile){
                pending++;
                entry.file(function(file){
                    // relativePath를 설정하기 위해 새 File 객체 생성
                    var relPath=pathPrefix?pathPrefix+'/'+file.name:file.name;
                    // File 객체에 _relPath 속성 추가
                    file._relPath=relPath;
                    result.push(file);
                    pending--;
                    if(pending===0) callback(result);
                },function(){pending--;if(pending===0)callback(result)});
            } else if(entry.isDirectory){
                pending++;
                var reader=entry.createReader();
                var allEntries=[];
                (function readAll(){
                    reader.readEntries(function(batch){
                        if(batch.length){
                            allEntries=allEntries.concat(Array.prototype.slice.call(batch));
                            readAll();
                        } else {
                            var dirPath=pathPrefix?pathPrefix+'/'+entry.name:entry.name;
                            for(var j=0;j<allEntries.length;j++) readEntry(allEntries[j],dirPath);
                            pending--;
                            if(pending===0) callback(result);
                        }
                    },function(){pending--;if(pending===0)callback(result)});
                })();
            }
        }
        for(var i=0;i<entries.length;i++) readEntry(entries[i],'');
    }

    // 드래그&드롭 파일 업로드 (폴더 구조 유지)
    function uploadDroppedFiles(fileList){
        // 폴더가 포함된 파일인지 확인
        var hasFolder=fileList.some(function(f){return f._relPath&&f._relPath.indexOf('/')>-1});
        if(!hasFolder){
            // 폴더 없이 순수 파일만 → 일반 업로드
            uploadFiles(fileList);
            return;
        }
        // 폴더 구조 유지하여 upload-folder API 사용
        var total=fileList.length,batchSize=20,uploaded=0,failed=0;
        var batches=[];
        for(var i=0;i<total;i+=batchSize) batches.push(fileList.slice(i,i+batchSize));
        showModal('📤 업로드','<div id="upload-prog-wrap"><div style="font-size:13px;margin-bottom:8px">0 / '+total+' 파일 업로드 중...</div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div id="upload-prog-bar" style="width:0%;height:100%;background:var(--blue);transition:width .3s"></div></div><div id="upload-prog-detail" style="font-size:11px;color:#888;margin-top:6px"></div></div>',[]);
        var ownerParam=shareMode?shareMode.owner:null;
        function sendBatch(idx){
            if(idx>=batches.length){
                refreshFiles();
                showModal('✅ 업로드 완료','총 '+uploaded+'개 파일 업로드'+(failed>0?' ('+failed+'개 실패)':''),[{label:'확인',cls:'primary'}]);
                return;
            }
            var batch=batches[idx];
            var fd=new FormData();
            for(var j=0;j<batch.length;j++){
                var f=batch[j];
                fd.append('files',f,f._relPath||f.name);
            }
            fd.append('basePath',currentPath);
            if(ownerParam) fd.append('owner',ownerParam);
            $.ajax({url:apiUrl('/api/upload-folder'),type:'POST',data:fd,processData:false,contentType:false,
                success:function(r){
                    uploaded+=(r.count||batch.length);
                    var pct=Math.round(uploaded/total*100);
                    $('#upload-prog-bar').css('width',pct+'%');
                    $('#upload-prog-wrap div:first').text(uploaded+' / '+total+' 파일 업로드 중...');
                    $('#upload-prog-detail').text('배치 '+(idx+1)+'/'+batches.length+' 완료');
                    sendBatch(idx+1);
                },
                error:function(){
                    failed+=batch.length;uploaded+=batch.length;
                    var pct=Math.round(uploaded/total*100);
                    $('#upload-prog-bar').css('width',pct+'%');
                    sendBatch(idx+1);
                }
            });
        }
        sendBatch(0);
    }

    // welcome 화면 HTML 캐시 (새대화 시 재사용)
    window._welcomeHtml = $('#welcome').length ? $('#welcome').prop('outerHTML') : '';
    // i18n 초기화
    initI18n();
});

// ================================================================
// i18n - 다국어 지원
// ================================================================
var _i18n = {};
var _lang = window.__LANG__ || 'ko';

function T(key, fallback) {
    return _i18n[key] || fallback || key;
}

function initI18n() {
    $.getJSON('/static/lang/' + _lang + '.json?v=' + (window._appVer||'1'), function(data) {
        _i18n = data;
        applyI18n();
    }).fail(function() {
        console.warn('i18n: Failed to load ' + _lang + '.json');
    });
}

function applyI18n() {
    if (!_i18n || !Object.keys(_i18n).length) return; // 데이터 없으면 스킵
    // HTML 고정 텍스트 교체 (셀렉터 → 키 매핑)
    // 헤더
    document.title = T('app_title');
    $('.hdr-logo-sub').text(T('logo_sub'));

    // 좌측 패널
    $('.lp-title').text(T('tab_chat'));

    // 우측 패널 탭
    $('.rp-tab[data-rptab="files"]').html('📁 ' + T('my_files'));
    $('.rp-tab[data-rptab="shared"]').html('🤝 ' + T('shared'));

    // 파일 버튼
    $('#btn-upload').html('<span class="material-icons-outlined" style="font-size:14px">upload_file</span> ' + T('btn_file'));
    $('#btn-upload-folder').html('<span class="material-icons-outlined" style="font-size:14px">drive_folder_upload</span> ' + T('btn_folder'));
    $('#btn-new-folder').html('<span class="material-icons-outlined" style="font-size:14px">create_new_folder</span> ' + T('btn_new_folder'));
    $('#btn-dl-folder').html(T('btn_download'));
    $('#btn-delete-all').html(T('btn_delete_all'));

    // 헤더 버튼
    $('#btn-infographic').each(function(){ $(this).find('.hdr-btn-text').length ? $(this).find('.hdr-btn-text').text(T('hdr_infographic')) : null; });
    $('[id="btn-infographic"]').contents().filter(function(){return this.nodeType===3}).last().replaceWith(' '+T('hdr_infographic'));
    $('[id="btn-slidedeck"]').contents().filter(function(){return this.nodeType===3}).last().replaceWith(' '+T('hdr_slide'));
    $('[id="btn-schedule"]').contents().filter(function(){return this.nodeType===3}).last().replaceWith(' '+T('hdr_schedule'));
    $('[id="btn-figma-convert"]').contents().filter(function(){return this.nodeType===3}).last().replaceWith(' '+T('hdr_figma'));

    // 입력 영역
    $('#msg-input').attr('placeholder', T('input_placeholder'));
    $('#attach-btn').attr('title', T('attach_title'));
    $('#stop-btn').attr('title', T('stop_title'));

    // 입력 힌트 (칩 제외 span)
    var $hint = $('.input-hint');
    $hint.find('span:not(.input-chip)').text(T('input_hint'));
    $('#chip-infographic').html('<span class="material-icons-outlined">insert_chart</span> ' + T('chip_infographic'));
    $('#chip-slidedeck').html('<span class="material-icons-outlined">slideshow</span> ' + T('chip_slide'));
    $('#chip-figma').html('<span class="material-icons-outlined">palette</span> ' + T('chip_figma'));

    // 웰컴 카드
    var cards = $('#welcome .wc-card');
    var cardTexts = [T('welcome_card1'), T('welcome_card2'), T('welcome_card3'), T('welcome_card4')];
    cards.each(function(i) {
        $(this).find('.wc-card-text').text(cardTexts[i] || '');
    });
    $('#welcome .wc-sub').text(T('welcome_sub'));

    // 연결 상태
    $('.hdr-status span:last').text(T('hdr_connected'));

    // 폴더 바
    $('.input-folder-bar').contents().filter(function(){return this.nodeType===3}).first().replaceWith(' ' + T('folder_bar_label') + ' ');

    // 이동 바
    $('#btn-move-here').text(T('move_here'));
    $('#btn-move-cancel').text(T('btn_cancel'));
}
