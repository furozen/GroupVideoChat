
/*********************************************************************************
 The MIT License (MIT)

 Copyright (c) 2017 Xirsys

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

 *********************************************************************************/

/**********************
 * typescript/angular version Andy Malahovsky 2019
 * funrozen@gmail.com
 */

//I doubt it is need here.
import 'webrtc-adapter';

export class XirsysSignal{

  info;
  sig;
  tmpToken;
  sigHostPath;
  pendListeners;
  heartbeat;
  evtListeners;
  private channelPath: string;
  host;

  constructor (private apiUrl?:string, public userName?:string, info?:any ) {
    if(!info) info = {};
    this.info = info;
    //internal values
    this.sig = null;//local signal object.
    this.tmpToken;//authorized token for signal calls
    this.sigHostPath;//full authorized path to signaling service.
    this.pendListeners = [];//event listener - hold until init.
    this.heartbeat;//interval that keeps the signal open.
    this.evtListeners = {};

    //path to channel we are sending data to.
    //this.channelPath = !!info.channel ? this.cleanChPath(info.channel) : '';

    this.userName = !!userName ? userName : null;
    this.apiUrl = !!apiUrl ? apiUrl : '/webrtc';
    //console.log('*signal*  constructed');
    this.connectTo( !!info.channel ? info.channel : '' );
  }

  ver = 'v2';
  static keepAliveInt = 800;
  connected = false;

  close(){
    console.log('close ',this.sig);
    if(this.heartbeat) this.stopHeart();
    if(this.sig) this.sig.close();
  }

  connectTo(channel){
    this.channelPath = !!channel ? this.cleanChPath(channel) : '';
    console.log('connectTo: ',this.channelPath);
    //if connected stop current, then do new.
    if(!!this.sig){
      this.close();
      const own = this;
      setTimeout(() => {own.doToken()}, 800);
    } else if(!!this.apiUrl){//!!this.userName &&
      this.doToken();//first get our token.
    } else {
      console.log('Error: Could connect signal!');
    }
    return true;
  }

  doToken(){
    const path = this.apiUrl + '/_token' + this.channelPath + '?k=' + this.userName;
    console.log('*signal*  PUT doToken to '+path);
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = ($evt) =>{
      if(xhr.readyState == 4 && xhr.status == 200){
        const res = JSON.parse(xhr.responseText);
        this.tmpToken = (res as any).v;
        if(this.tmpToken == 'no_namespace') {
          console.log('*signal*  fail: ', this.tmpToken);
          return;
        }
        console.log('*signal*  token: ',this.tmpToken);
        this.doSignal();
      }
    }
    xhr.open("PUT", path, true);
    xhr.send( );
  }

  doSignal(){
    console.log('*signal*  GET doSignal to '+this.apiUrl+'/_host'+this.channelPath+'?type=signal&k='+this.userName);
    const path = this.info.channel ? this.apiUrl + '/_host' + this.channelPath + '?type=signal&k=' + this.userName : this.apiUrl + '/_host?type=signal&k=' + this.userName;

    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = ($evt) =>{
      if(xhr.readyState == 4 && xhr.status == 200){
        const res = JSON.parse(xhr.responseText);
        this.host = (res as any).v +'/'+this.ver+'/'+ this.tmpToken;
        console.log('signal host: ',this.host);
        this.setupSocket();
      }
    }
    xhr.open("GET", path, true);
    xhr.send(  );

  }

  //setup socket to signaling server.
  setupSocket(){
    console.log('*signal*  setupSocket to '+this.host);
    const own = this;
    this.sig = new WebSocket(this.host);
    //notify when connection is open
    this.sig.addEventListener('open', evt => {
      own.startHeart();
      own.connected = true;
    });
    //notify when connection closed
    this.sig.addEventListener('close', evt => {
      if(this.heartbeat) own.stopHeart();
      own.connected = false;
      this.sig = null;
    });
  
    //add pending listeners to signaling object.
    const l = this.pendListeners.length;
    if(l > 0){
      for(let i=0; i<l; i++ ){
        const item = this.pendListeners[i];
        this.on(item.event,item.f);
      }
      this.pendListeners = [];
    }
    //notify when a message is received from signal network.
    this.sig.addEventListener('message', msg => {
      const pkt = JSON.parse(msg.data);
      console.log('*signal*  signal message! ',pkt);
      const payload = pkt.p;//the actual message data sent
      const meta = pkt.m;//meta object
      const msgEvent = meta.o;//event label of message
      const toPeer = meta.t;//msg to user (if private msg)
      let fromPeer = meta.f;//msg from user
      if(!!fromPeer) {//remove the peer path to display just the name not path.
        const p = fromPeer.split('/');
        fromPeer = p[p.length - 1];
      }
      switch (msgEvent) {
        //first connect, list of all peers connected.
        case "peers":
          //this is first call when you connect, 
          //  so we can check for channelPath here dynamically.
          const sysNum = meta.f.lastIndexOf('__sys__');
          if(sysNum > -1 && !this.channelPath){
            own.channelPath = meta.f.substring(0,sysNum);//save message path for sending.
            console.log('*signal*  channelPath ',this.channelPath);
          }
          //setUsers(payload.users);
          break;
        //new peer connected
        case "peer_connected":
          //addUser(fromPeer);
          break;
        //peer left.
        case "peer_removed":
          //removeUser(fromPeer);
          break;
        //message received. Call to display.
        case 'message':
          //onUserMsg(payload.msg, fromPeer, toPeer);
          const data = payload.msg;
          data.f = fromPeer;
          if(data.type == 'candidate' || data.type == 'offer' || data.type == 'answer' || data.type == 'custom' ){
            own.emit(data.type, data);
          }
          break;
      }
      own.emit('message', msg.data);
    });
    //console.log('sig:  ',this.sig);
  }
  // User event, sends user message.
  sendMessage(msg, toPeer, info){
    if(!info) info = {};
    console.log('*signal*  sendMessage: ',msg,', to: ',toPeer,' info: ',info);
    if(msg == undefined || msg.length < 1) return;
    const pkt = {
      t:'u', // user message service
      m:{
        f:this.channelPath + this.userName,
        o:!!info.m_event ? info.m_event : 'message',
        t:''
      },
      p:{msg:msg}
    };
    //if its to a peer, add direct message var (t) to meta object.
    if(!!toPeer) pkt.m.t = toPeer;
    //console.log('*signal*  sendMessage pkt: ',pkt);
    this.sig.send(JSON.stringify(pkt));
  
    return pkt;
  }

  //formats the custom channel path how we need it.
  cleanChPath(path){
    //has slash at front
    if(path.indexOf('/') != 0) path = '/'+path;
    if(path.lastIndexOf('/') == (path.length - 1)) path = path.substr(0,path.lastIndexOf('/'));
    //console.log('cleanChPath new path: '+path);
    return path;
  }
  
  //Keeps pinging signal server to keep connection alive.
  startHeart(){
    //console.log('*signal*  startHeart ',this.keepAliveInt);
    if(!!this.heartbeat) clearInterval(this.heartbeat);
    const own = this;
    this.heartbeat = setInterval( ()=> {own.sig.send('ping');}, XirsysSignal.keepAliveInt);
  }
  
  stopHeart(){
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    //this.sig = null;
    console.log('signal closed!');
  }

  //events
  on(sEvent,cbFunc){
    //console.log('*signal*  on ',sEvent,', func: '+cbFunc);
    if(!sEvent || !cbFunc) {
      console.log('error:  missing arguments for "on" event.');
      return false;
    }
    //if event does not exist create it and give it an array for listeners.
    if(!this.evtListeners[sEvent]) this.evtListeners[sEvent] = [];
    //add listener to event.
    this.evtListeners[sEvent].push(cbFunc);
  }
  off(sEvent,cbFunc){
    if (!this.evtListeners.hasOwnProperty(sEvent)) return false;//end

    const index = this.evtListeners[sEvent].indexOf(cbFunc);
    if (index != -1) {
      this.evtListeners[sEvent].splice(index, 1);
      return true;//else end here.
    }
    return false;//else end here.
  }

  emit(sEvent, data){
    //console.log('*signal*  emit ',sEvent,', func: '+data);
    const handlers = this.evtListeners[sEvent];
    if(!!handlers) {
      const l = handlers.length;
      for(let i=0; i<l; i++){
        const item = handlers[i];
        item.apply(this,[{type:sEvent,data:data}]);
      }
    }
  }
}



export class XirsysIce{
  private info: any;
  private apiUrl: string;
  private evtListeners: any;
  private channelPath: string;
  private iceServers: any;
  constructor(apiUrl, info) {
    if(!info) info = {};
    this.info = info;
    this.apiUrl = !!apiUrl ? apiUrl : '/webrtc';
    this.evtListeners = {};

    //path to channel we are sending data to.
    this.channelPath = !!info.channel ? this.cleanChPath(info.channel) : '';

    if(!!this.apiUrl){
      this.doICE();//first get our token.
    }
  }

  onICEList = 'onICEList';
  
  doICE () {
    console.log('*ice*  doICE: ',this.apiUrl+"/_turn"+this.channelPath);
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = ($evt)=>{
      if(xhr.readyState == 4 && xhr.status == 200){
        const res = JSON.parse(xhr.responseText);
        console.log('*ice*  response: ',res);
        this.iceServers = this.filterPaths(res.v.iceServers);
        this.emit(this.onICEList);
      }
    };
    const path = this.apiUrl + '/_turn' + this.channelPath;
    xhr.open("PUT", path, true);
    xhr.send();
  }

  //check for depricated RTCIceServer "url" property, needs to be "urls" now.
  filterPaths(arr){
    const l = arr.length;
    let i;
    const a = [];
    for(i=0; i<l; i++){
      const item = arr[i];
      const v = item.url;
      if(!!v){
        item.urls = v;
        delete item.url;
      }
      a.push(item);
    }
    return a;
  }

  //formats the custom channel path how we need it.
  cleanChPath(path){
    //has slash at front
    console.log('cleanChPath path recv: '+path);
    if(path.indexOf('/') != 0) path = '/'+path;
    if(path.lastIndexOf('/') == (path.length - 1)) path = path.substr(0,path.lastIndexOf('/'));
    console.log('cleanChPath new path: '+path);
    return path;
  }

  on(sEvent,cbFunc){
    //console.log('*ice*  on ',sEvent);
    if(!sEvent || !cbFunc) {
      console.log('error:  missing arguments for on event.');
      return false;
    }
    if(!this.evtListeners[sEvent]) this.evtListeners[sEvent] = [];
    this.evtListeners[sEvent].push(cbFunc);
  }
  off(sEvent,cbFunc){
    if (!this.evtListeners.hasOwnProperty(sEvent)) return false;//end

    const index = this.evtListeners[sEvent].indexOf(cbFunc);
    if (index != -1) {
      this.evtListeners[sEvent].splice(index, 1);
      return true;//else end here.
    }
    return false;//else end here.
  }

  emit(sEvent){
    const handlers = this.evtListeners[sEvent];
    if(!!handlers) {
      const l = handlers.length;
      for(let i=0; i<l; i++){
        const item = handlers[i];
        item.apply(this,[{type:this.onICEList}]);
      }
    }
  }
}



export class XirsysP2Group {
  private isCaller: boolean;
  private evtListeners: any;
  private sig: any;
  private servers: any;
  private forceTurn: boolean;
  private stream: any;
  private remoteStreams: any;
  private firstConnect: boolean;
  private pcList: any;
  constructor(signal, mediaStream, servers, info) {
    if (!info) info = {};
    //info can have TURN only filter.
    console.log('*p2group*  constructor - servers:', servers, 'mediaStream:', mediaStream, 'sig:', signal, 'info:', info);
    this.evtListeners = {};
    //this.pc;//peer connection

    const own = this;
    this.sig = signal;
    if (!!this.sig) {
      this.sig.on('candidate', evt => {
        own.receiveCandidate(evt);
      });
      this.sig.on('offer', evt => {
        own.receiveOffer(evt);
      });
      this.sig.on('answer', evt => {
        own.receiveAnswer(evt);
      });
      this.sig.on('custom', evt => {
        own.onCustomMSG(evt);
      });
    }
    this.servers = !!servers ? servers : {};
    this.forceTurn = !!info.forceTurn ? info.forceTurn : false;
    this.stream = mediaStream;
    //this.remotePeerID;
    this.remoteStreams = {};//current live streams
    this.firstConnect = true;
    this.isCaller = false;//true / false
    this.pcList = {};
  }

  peerConnSuccess = 'peer.connect.success';



//webrtc: this client received a peer candidate from remote peer.
  receiveCandidate(evt) {
    const iceCandidate = evt.data;
    const peerInfo = this.getLivePeer(iceCandidate.f);
    //console.log('*p2group*  receiveCandidate  peer: ',peerInfo,', ',iceCandidate);
    try {
      const rtcIceCandidate = new RTCIceCandidate(iceCandidate);
      peerInfo.pc.addIceCandidate(rtcIceCandidate);
    } catch (e) {
      console.log('Error: Could not set remote candidate for: ', iceCandidate.f, '. Peer info is: ', peerInfo);
    }
  }

//webrtc: this client received offer from a remote peer to do a call.
  receiveOffer(evt) {
    const desc = evt.data;
    const peerID = desc.f;
    console.log('*p2group*  receiveOffer', desc, 'peerID =', peerID);
    //if(!this.remotePeerID && !!desc.f) this.remotePeerID = desc.f;
    const peerInfo = this.getLivePeer(peerID);
    let pc = !!peerInfo ? peerInfo.pc : null;
    console.log('*p2group*  !pc ', pc, ', !iscaller: ', this.isCaller);
    if (!pc && !this.isCaller) {
      pc = this.createPeerConnection(peerID);
      if (!!pc) {
        (pc as any).addStream(this.stream);
        this.pcList[peerID] = {id:peerID, pc:pc, requestGroup:false, stream:null};
      }
    }
    const own = this;
    pc.setRemoteDescription(new RTCSessionDescription(desc));
    pc.createAnswer()
      .then(desc => {
        own.setLocalAndSendMessage(desc, peerID);
      }) // success
      .catch(err => {
        own.onCreateSessionDescriptionError(err);
      }); // error
    //this.isCaller = false;
  }

//webrtc: the local client receiced an answer from the remote peer this client called.
  receiveAnswer(evt) {
    const desc = evt.data;
    console.log('*p2group*  receiveAnswer ', desc);
    const peerInfo = this.getLivePeer(desc.f);
    if (peerInfo == null) return;//not the peer were looking for.
    peerInfo.pc.setRemoteDescription(new RTCSessionDescription(desc));
  }

  onCustomMSG(evt) {
    console.log('*p2group*  onCustomMSG ', evt);
    const desc = evt.data;
    let list = [];
    //try{
    switch (desc.code) {
      case 'request_peergroup':
        list = this.getPeersList();
        console.log('Peers List:', list);
        this.sig.sendMessage({type:'custom', code:'receive_peergroup', data:list}, desc.f);
        break;
      case 'receive_peergroup':
        console.log('Got List to connect ', desc.data);
        //todo remove oursleves from the list. create connections.
        list = desc.data;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          console.log('username ', this.sig.userName);
          if (item != this.sig.userName) {
            this.callPeer(item);
          }
        }
        break;
    }
    //} catch(e) {
    //console.log('Could not apply custom msg ',evt);
    //}
    const peerInfo = this.getLivePeer(desc.f);
  }

  createPeerConnection(peerID):RTCPeerConnection {
    console.log('*p2group*  createPeerConnection ', peerID);
    //if(!!this.pc) return true;
    try {
      console.log('RTCPeerConnection servers:  ', this.servers);
      const pc:RTCPeerConnection = new RTCPeerConnection(this.servers);

      pc.addEventListener("icecandidate", (evt)=>
      {
        //send to peer
        let cand = evt.candidate;
        if (!cand) return;
        //if we are forcing turn and this is NOT a relay type, ignore candidate.
        if (this.forceTurn && cand.candidate.indexOf('typ relay') == -1) {
          cand = null;
        } else {
          this.sig.sendMessage({
            type:'candidate',
            candidate:cand.candidate,
            sdpMid:cand.sdpMid,
            sdpMLineIndex:cand.sdpMLineIndex
          }, peerID);//own.remotePeerID);
        }
      });

      pc.addEventListener("addstream",  evt => {
        console.log('*p2group* ' + peerID + ' onaddstream evt:', evt);
        //TODO "as any!"
        this.addStream((evt as any).stream, peerID);//remoteStreams
      });

      pc.addEventListener("removestream",  evt => console.log('*p2group* ' + peerID + ' onremovestream ', evt));
      pc.addEventListener("connectionstatechange", evt => {
        console.log("*p2group* " + peerID + " onconnectionstatechange: " + pc.connectionState)
      });
      pc.addEventListener("iceconnectionstatechange", evt => {

        console.log("*p2group* " + peerID + " oniceconnectionstatechange: " + pc.iceConnectionState);
        switch (pc.iceConnectionState) {
          case 'checking':
            break;
          case 'connected':
            //todo - do call to connect to rest of group.
            console.log('call group?', this.pcList[peerID].requestGroup, ', firstConnect?', this.firstConnect);
            if (!!this.pcList[peerID].requestGroup && !!this.firstConnect) {
              this.firstConnect = false;
              this.pcList[peerID].requestGroup = false;
              this.doRequestGroup(peerID);
            }
            break;
          case 'disconnected':
            console.log('*p2group* ' + peerID + ' disconnected ', evt);
            break;
          case 'closed':
            const peerInfo = this.getLivePeer(peerID);
            try {
              delete peerInfo.pc;
              delete this.pcList[peerID];
            } catch (e) {
              console.log('Error: Could not close call with:', peerID, '. Peer info is:', peerInfo);
            }
            console.log('id:', peerID, 'pcList:', this.pcList, ', item:', this.pcList[peerID]);
            break;
        }
      });

      return pc;
    } catch (e) {
      console.log('Failed to create PeerConnection, exception: ' + e.message);
      return;
    }
  }

  //this user initates a remote peer call
  callPeer(peerID) {
    console.log('*p2group*  callPeer ', peerID);
    let pc = this.createPeerConnection(peerID);
    if (!!pc) {
      this.isCaller = true;
      //this.remotePeerID = peerID;
      this.pcList[peerID] = {id:peerID, pc:pc, requestGroup:false, stream:null};
      (pc as any).addStream(this.stream);
      pc.createOffer()
        .then(desc => {
          this.setLocalAndSendMessage(desc, peerID);
        }) // success
        .catch(err => {
          this.onCreateSessionDescriptionError(err);
        });
      // error
      if (this.firstConnect) {
        this.pcList[peerID].requestGroup = true;//call peer to request its group members.
      }
    }
  }


  hangup(peerID) {
    const peerInfo = this.getLivePeer(peerID);
    try {
      peerInfo.pc.close();
      const stream = this.remoteStreams[peerID];
      this.remoteStreams[peerID] = null;
      //this.remotePeerID = null;
    } catch (e) {
      console.log('Error: Could not hangup call with: ', peerID, '. Peer info is: ', peerInfo);
    }
    //if no streams close and nulify pc.
    //this.pc = null;
  }

  addStream(remoteStream, peerID) {
    const peerInfo = this.getLivePeer(peerID);
    try {
      peerInfo.stream = remoteStream;
    } catch (e) {
      console.log('Error: Could not update stream for: ', peerID, '. Peer info is: ', peerInfo);
    }
    this.isCaller = false;
    this.emit(this.peerConnSuccess, peerID);
  }

  getLiveStream(peerID) {
    const peerInfo = this.getLivePeer(peerID);
    try {
      return peerInfo.stream;
    } catch (e) {
      console.log('Error: Could not update stream for: ', peerID, '. Peer info is: ', peerInfo);
    }
  }

  getLivePeer(peerID) {
    return this.pcList[peerID];
  }

  getPeersList() {
    const list = [];
    for (let i in this.pcList) list.push(i);
    return list;
  }

  length() {
    let l = 0;
    for (let i in this.pcList) l++;
    return l;
  }

  doRequestGroup(peerID) {
    this.sig.sendMessage({type:'custom', code:'request_peergroup'}, peerID);
  }

  setLocalAndSendMessage(sessionDescription, peerID) {
    console.log('*p2group*  setLocalAndSendMessage sending message', sessionDescription, ', id:', peerID);
    const peerInfo = this.getLivePeer(peerID);
    try {
      peerInfo.pc.setLocalDescription(sessionDescription);
      console.log('sendMessage for: ', peerID);
      this.sig.sendMessage(sessionDescription, peerID);
    } catch (e) {
      console.log('Error: Could not set local session description for: ', peerID, 'connection. Peer info is: ', peerInfo);
    }
  }

  onCreateSessionDescriptionError(error) {
    console.log('Failed to create session description: ', error);
  }

  /* EVENTS */

  on(sEvent, cbFunc) {
    //console.log('*p2group*  on ',sEvent,', func: '+cbFunc);
    if (!sEvent || !cbFunc) {
      console.log('error:  missing arguments for on event.');
      return false;
    }
    if (!this.evtListeners[sEvent]) this.evtListeners[sEvent] = [];
    this.evtListeners[sEvent].push(cbFunc);
  }

  off(sEvent, cbFunc) {
    console.log('off');
    this.evtListeners.push(cbFunc);
  }

  emit(sEvent, data) {
    const handlers = this.evtListeners[sEvent];
    if (!!handlers) {
      const l = handlers.length;
      for (let i = 0; i < l; i++) {
        const item = handlers[i];
        item.apply(this, [{type:sEvent, data:data}]);
      }
    }
  }
}
