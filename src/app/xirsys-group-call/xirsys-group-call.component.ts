import {AfterViewInit, Component, ElementRef, OnInit, QueryList, ViewChild, ViewChildren} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {XirsysIce, XirsysP2Group, XirsysSignal} from '../xirsys';
import {environment} from '../../environments/environment';

type VideoItemType = { id: string, stream: any };

@Component({
  selector:'app-xirsys-group-call',
  templateUrl:'./xirsys-group-call.component.html',
  styleUrls:['./xirsys-group-call.component.scss']
})
export class XirsysGroupCallComponent implements OnInit, AfterViewInit {

  title: string;
  @ViewChild('callID', {static:false}) callIdElRef: ElementRef;
  callIdEl;
  @ViewChild('isTURNcb', {static:false}) turnCB: ElementRef;
  @ViewChild('isTURN', {static:false}) turnViewEL: ElementRef;
  @ViewChild('share-view', {static:false}) shareViewEl: ElementRef;
  @ViewChild('share-title', {static:false}) shareTitleEl: ElementRef;
  @ViewChild('myVideo', {static:false}) localVideoEl: ElementRef;

  @ViewChildren('videos') videos !: QueryList<any>;
  mediaConstraints: MediaStreamConstraints = {
    audio:true,
    video:{
      //it does not seems working use data-setup instead. check video elements in the html to example
      advanced:[
        {'width':640, 'height':480},//320x240
        {'width':800, 'height':600}//1024x768
      ]

    }
  };
  localStream;//local audio and video stream
  ice;//ice server query.
  sig;//sigaling
  peer;//peer connection.
  /*if url has callid wait for other user in list with id to call
      else if no id in url create a sharable url with this username.*/
  username;//local username created dynamically.
  remoteCallID;//id of remote user
  inCall = false;//flag true if user in a call; or false if not.
  channelPath = '';//set this variable to specify a channel path
  vidsList: Map<string, VideoItemType> = new Map<string, VideoItemType>();//list of live streams.
  private uriParams;

  constructor(private route: ActivatedRoute) {
  }
  getVidList():Array<VideoItemType>  {
    return Array.from(this.vidsList.values());
  }
  getURLParameter(name) {
    return this.uriParams[name];
  };

  ngOnInit() {}

  ngAfterViewInit(): void {
    this.route.queryParams.subscribe((params) => {
      this.uriParams = params;
      if (params.ch != 'null') {
        this.channelPath = params.ch;
      }
      console.log('channel path: ', this.channelPath);
      this.run();
    });

    this.videos.changes.subscribe((r:QueryList<any>) => {
      r.forEach((item:ElementRef)=>{
        console.log('v id:',item.nativeElement.id);
        const vel = this.vidsList.get(item.nativeElement.id);
         if(vel && vel.stream) {
           //todo there you can change relative video object properties
           //item.nativeElement.volume= 20;
         }
      });
      console.log('videos changed!');
    });
  }
  run(){
    this.callIdEl = this.callIdElRef.nativeElement;
    console.log('pretty loaded!!');

    this.username = this.guid();//create random local username
    const urlName = this.getURLParameter('callid');//get call id if exists from url
    if (!!urlName) {
      this.remoteCallID = urlName;
      this.title = 'Calling User...';
      this.callIdEl.value = this.remoteCallID;
      console.log('turnview: ', this.turnViewEL);

    } // if call id does not exist this is the callee
    else {
      this.callIdEl.value = location.origin + location.pathname + '?callid=' + this.username;

    }
    //get Xirsys service
    this.doICE();
  }

  onIsTurn(val) {
    console.log('click TURN: ', val);
    if (val === true) {
      this.callIdEl.value = location.origin + location.pathname + '?callid=' + this.username + '&isTURN=true';
    } else {
      this.callIdEl.value = location.origin + location.pathname + '?callid=' + this.username;
    }
    this.peer.forceTurn = val;
  }

//if there is no remoteCallID show sharable link to call user.

  callRemotePeer() {
    if (!!this.remoteCallID) {
      console.log('Calling ' + this.remoteCallID);
      this.peer.callPeer(this.remoteCallID);
    } else {
      console.log('Error', 'A remote peer was not found!');
    }
  }

// Get Xirsys ICE (STUN/TURN)
  doICE() {
    console.log('doICE ');
    if (!this.ice) {
      this.ice = new XirsysIce(environment.xirsysApiUrl, {channel:this.channelPath});
      this.ice.on(this.ice.onICEList, this.onICE);
    }
  }

  onICE = (evt) => {
    console.log('onICE ', evt);
    if (evt.type == this.ice.onICEList) {
      this.getMyMedia();
    }
  };

//Get local user media
  getMyMedia() {
    console.log('getMyMedia()');
    navigator.mediaDevices.getUserMedia(this.mediaConstraints)
      .then(str => {
        this.setLocalStream(str);
        this.doSignal();
      })//onSuccess
      .catch(err => {
        console.log('Could not get Media: ', err);
        alert('Could not get Media!! Please check your camera and mic.');
      });
  }

//Get Xirsys Signaling service
  doSignal() {
    this.sig = new XirsysSignal(environment.xirsysApiUrl, this.username, {channel:this.channelPath});
    this.sig.on('message', msg => {
      const pkt = JSON.parse(msg.data);
      //console.log('*index*  signal message! ',pkt);
      const payload = pkt.p;//the actual message data sent
      const meta = pkt.m;//meta object
      const msgEvent = meta.o;//event label of message
      const toPeer = meta.t;//msg to user (if private msg)
      let fromPeer = meta.f;//msg from user
      //remove the peer path to display just the name not path.
      if (!!fromPeer) {
        const p = fromPeer.split('/');
        fromPeer = p[p.length - 1];
      }
      switch (msgEvent) {
        //first Connect Success!, list of all peers connected.
        case 'peers':
          //this is first call when you connect,
          this.onReady();
          // if we are connecting to a remote user and remote
          // user id is found in the list then initiate call
          if (!!this.remoteCallID) {
            const users = payload.users;
            const l = users.length;
            for (let i = 0; i < l; i++) {
              const user = users[i];
              //if this is the user, call them.
              if (user === this.remoteCallID) {
                this.callRemotePeer();
              }
            }
          }
          break;
        //peer gone.
        case 'peer_removed':
          //if(fromPeer == remoteCallID) onStopCall();
          //todo - ceck if peer is one that is connected to us and stop that call.
          var p = this.peer.getLivePeer(fromPeer);
          console.log('has peer: ', p);
          if (!!p) {
            this.onStopCall(p.id);
          }
          break;

        // new peer connected
        //case "peer_connected":
        // 	addUser(fromPeer);
        // 	break;
        // message received. Call to display.
        //case 'message':
        // 	onUserMsg(payload.msg, fromPeer, toPeer);
        // 	break;
      }
    });
  }

//Ready - We have our ICE servers, our Media and our Signaling.
  onReady() {
    console.log('* onReady!');
    // setup peer connector, pass signal, our media and iceServers list.
    let isTURN = this.getURLParameter('isTURN') == 'true';//get force turn var.
    console.log('isTURN ', isTURN);
    this.peer = new XirsysP2Group(this.sig, this.localStream, (!this.ice ? {} : {iceServers:this.ice.iceServers}), {forceTurn:isTURN});
    //add listener when a call is started.
    this.peer.on(this.peer.peerConnSuccess, this.onStartCall);
  }

//CALL EVENT METHODS

// A peer call started udpate the UI to show remote video.
  onStartCall = (evt) => {
    console.log('*index*  onStartCall ', evt);
    const remoteId = evt.data;
    this.setRemoteStream(this.peer.getLiveStream(remoteId), remoteId);
    this.title = 'In call with user:';
    this.remoteCallID = remoteId;
    this.inCall = true;
  };

  onStopCall(uid) {
    console.log('*index*  onStopCall', uid);
    if (this.inCall) {
      this.peer.hangup(uid);
      this.delRemoteStream(uid);
    } else {
      console.log('could not find call for: ', uid);
    }
    if (this.peer.length == 0) {
      this.inCall = false;
      this.remoteCallID = null;
    }
  }

  /* UI METHODS */

//sets local user media to video object.
  setLocalStream(str) {
    console.log('setLocal Video ', str);
    this.localStream = str;
    //prevent echo noise
    // but not for local testing
    // just set mediaConstraints: audio:false, for this purpose
    // or set volume for relative videos
    this.localVideoEl.nativeElement.volume=0;
    this.localVideoEl.nativeElement.srcObject = this.localStream;
  }

//sets remote user media to video object.
  setRemoteStream(str, uid) {
    console.log('setRemote Video ', str);
    this.vidsList.set(uid, {stream:str, id:uid});//map name on obj
    console.log('vidsList add', this.vidsList);

  }

  setStream(el,item){
    //console.log(el);
    return item.id;
  }

//removes remote user media to video object.
  delRemoteStream(uid) {
    this.vidsList.delete(uid);
    console.log('vidsList del', this.vidsList);
    return true;
  }

  /* TOOLS */

//gets URL parameters

//makes unique userid
  guid(s = 'user') {
    let s4 = () => {
      return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
    };
    return s + s4() + s4();
  }



}
