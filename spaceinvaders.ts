// Written by Munir Azme
// Some functions and ideas derived from Asteroids example in FIT2102

import { fromEvent, identity, interval } from "rxjs"
import { filter, map, switchMap, merge, scan } from "rxjs/operators"
function spaceinvaders() {


    class Vec  {
      /*
      Derived Asteroids example. This is a basic vector class that provides commonly used operations.
      */
      constructor(public readonly x:number = 0, public readonly y:number = 0){}
      add = (vel:Vec) => new Vec(this.x+vel.x,this.y+vel.y)
      sub = (b:Vec) => this.add(b.scale(-1))
      scale = (s:number) => new Vec(this.x*s,this.y*s)
      negate = () => new Vec(-this.x,-this.y)
      zero = () => new Vec()
      len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
    }

    const CANVAS_SIZE = 600,
      BULLET_RAD = 5,
      INIT_ENEMIES = 27,
      // INIT_ENEMIES = 18,
      ENEMIES_PER_ROW = 9,
      SHIP_DAMAGE_RADIUS = 20,
      SHIP_VEL:Vec = new Vec (2,0),
      FRIENDLY_BULLET_VEL = new Vec(0,-4),
      ENEMY_BULLET_VEL = new Vec(0,1),
      ENEMY_VEL = new Vec (0.5,0),
      ENEMY_VERTICAL_VEL = new Vec(0,20),
      ENEMY_COOLDOWN_TICKS = 500, // Number of ticks before all the enemies move down
      ENEMY_GAP = 60, // Gap between each pair of enemies
      SHIELD_BLOCK_SIZE = 13, 
      BLOCKS_PER_SHIELD = 7,
      SHIELD_GRID = [new Vec(SHIELD_BLOCK_SIZE,0),new Vec(SHIELD_BLOCK_SIZE*2,0),new Vec(-SHIELD_BLOCK_SIZE,0),new Vec(-SHIELD_BLOCK_SIZE*2,0),new Vec(0,-SHIELD_BLOCK_SIZE),
        new Vec(-SHIELD_BLOCK_SIZE,-SHIELD_BLOCK_SIZE),new Vec(SHIELD_BLOCK_SIZE,-SHIELD_BLOCK_SIZE)], // Grid of shield blocks that make up a shield
      SHIELD_POS = [new Vec(30,490),new Vec(186,490),new Vec(372,490),new Vec(549,490)], // Centre position of each shield
      SHIELD_DAMAGE_RADIUS = 10

    // Derived from Asteroids example. All objects in the game are a body.
    type Body = Readonly<{
      id:string,
      type:string
      pos:Vec,
      vel:Vec,
      cooldown:number
      radius:number
    }>

    // Derived from Asteroid examples. Holds the state of the game
    type State = Readonly<{
      time:number,
      ship:Body, // The players ship
      bullets:ReadonlyArray<Body>, // All the bullets in the game, friendly and enemy
      enemies:ReadonlyArray<Body>,
      exit:ReadonlyArray<Body>, // Objects that will be removed from the display
      objCount:number,
      gameOver:boolean,
      score:number,
      shields:ReadonlyArray<Body>,
      highScore:number,
      level:number
    }>

    class RNG {
      // Derived from Week 5 tutorial
      m = 0x80000000// 2**31
      a = 1103515245
      c = 12345
      state:number
      constructor(seed:number) {
        this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
      }
      nextInt() {
        this.state = (this.a * this.state + this.c) % this.m;
        return this.state;
      }
      nextFloat() {
        // returns in range [0,1]
        return this.nextInt() / (this.m - 1);
      }
      next(){
        return new RNG(this.nextInt())
      }
    }

    
    // Generic function to create any body (ship, enemies, bullets)
    const createBody = (velocity:Vec) => (type:string) => (id:string) => (position:Vec) => (radius:number) => <Body>{
      id: type+id,
      type:type,
      pos: position,
      vel: velocity,
      radius: radius,
      cooldown: 0,
    },

      createEnemy = createBody(ENEMY_VEL)("Enemy"),
      /*1D array containing enemies at the start of each level. We first accumulate an array of positions by using reduce. For each enemy we check if we have gone over the limit for number of enemies per row.
      If we have then we go to a new row, else stay on the same one. Then we map each position to a body object.
      */

      initial_enemies:Body[] = [...Array(INIT_ENEMIES-1)]
      .reduce((pos:Vec[],_) => pos[pos.length - 1].x > (ENEMIES_PER_ROW-1)*ENEMY_GAP ? pos.concat(new Vec(ENEMY_GAP,pos[pos.length - 1].y+ENEMY_GAP))
                                : pos.concat(new Vec(pos[pos.length - 1].x+ENEMY_GAP,pos[pos.length - 1].y)), [new Vec(ENEMY_GAP,ENEMY_GAP)]).map((pos:Vec,i:number)=>createEnemy(i.toString())(pos)(SHIP_DAMAGE_RADIUS)),



    createShieldBlock = createBody(new Vec(0,0))("shield"),

    // Function that creates a shield which is a grid of shield blocks
    createShield = (shield_centre:Vec)=>(shield_num:number) : ReadonlyArray<Body> =>
      SHIELD_GRID.map((block, index) => createShieldBlock((index+shield_num*BLOCKS_PER_SHIELD).toString())(shield_centre.add(block))(SHIELD_DAMAGE_RADIUS)),
    
    // Shield blocks at the start of the each level
    initial_shields = SHIELD_POS.map((shield_centre,i)=>createShield(shield_centre)(i)).flat()
    
    
    const initialState:State = {
      time:0,
      ship:createBody(new Vec())("ship")("")(new Vec(CANVAS_SIZE/2,CANVAS_SIZE-50))(SHIP_DAMAGE_RADIUS), // Player starts at the middle of the canvas
      bullets:[],
      enemies:initial_enemies,
      exit:[],
      objCount:0,
      gameOver:false,
      score: 0,
      shields:initial_shields,
      highScore:0,
      level:0
    }

    // Used to constraint the player to only move within the bounds of the canvas
    const shipBounds = ({x,y}:Vec) => { 
      const bound = (x:number) => 
        x < SHIP_DAMAGE_RADIUS ? SHIP_DAMAGE_RADIUS : x>CANVAS_SIZE-SHIP_DAMAGE_RADIUS ? CANVAS_SIZE-SHIP_DAMAGE_RADIUS: x;
      return new Vec(bound(x),y)
    };

    // Function to create friendly or enemy bullets
    function createBullet(s:State,shooter:Body, velocity:Vec):Body {
      const bullet_pos = shooter.type ==="ship" ? shooter.pos.add(new Vec(0,-5)) : shooter.pos.add(new Vec(0,5))
      const bullet_vel = velocity
      return createBody(bullet_vel)(shooter.type ==="ship"? "bullet":"enemy_bullet")(`bullet${s.objCount}`)(bullet_pos)(BULLET_RAD)
    }

    // Create a bullet from a random enemy using number from random number stream
    function enemyFire(s:State,enemy_index:number):Body {
      const enemy= s.enemies[Math.round(enemy_index*(s.enemies.length-1))]
      return createBullet(s,enemy,ENEMY_BULLET_VEL)

    }

    // Actions that change the state of the game
    class Tick{constructor(public readonly elapsed:number){}}
    class Move{constructor(public readonly direction:number){}} // Class to show how the player is moving. If direction is positive they are right and negeative for left. Direction becomes 0 when they stop.
    class Shoot{constructor(){}}
    class Restart{constructor(){}}
    class EnemyShoot{constructor(public readonly enemy_index:number){}}

    // Derived from Asteroids example, used to return a function when an event occurs on a particular button
    const observeKey = <T>(eventName:string, buttonPressed:string, result:()=>T) =>
    fromEvent<KeyboardEvent>(document,eventName)
      .pipe(filter(({code})=>code === buttonPressed), filter(({repeat})=>!repeat),map(result))

      // Streams of user input, that change the state of the game
  const startMoveLeft = observeKey("keydown","ArrowLeft", ()=>new Move(-1)),
        startMoveRight = observeKey("keydown","ArrowRight", ()=>new Move(1)),
        shoot = observeKey("keydown","Space", ()=>new Shoot()),
        stopMoveLeft = observeKey("keyup","ArrowLeft", ()=>new Move(0)),
        stopMoveRight = observeKey("keyup","ArrowRight", ()=>new Move(0)),
        restart = observeKey("keydown","KeyR", ()=>new Restart())
        
    // Function used to update position of an object based on it's velocity
  const moveObj = (o:Body) => <Body>{
    ...o,
    pos: o.type==="ship" ? shipBounds(o.pos.add(o.vel)): o.pos.add(o.vel) // If it's a ship, bound it within the canvas
  }

   // Function to check if any enemies are at the bounds of the canvas
  function enemyatBounds (enemies:ReadonlyArray<Body>):Boolean{
    return enemies.filter((enemy)=> enemy.pos.x < SHIP_DAMAGE_RADIUS ? true : enemy.pos.x>CANVAS_SIZE-SHIP_DAMAGE_RADIUS ? true: false).length>0
  }

  // Function to change velocity of enemies depending on state
  function moveEnemies (enemies:ReadonlyArray<Body>):ReadonlyArray<Body>{
    const enemy_at_bounds = enemyatBounds(enemies)
    return enemies.map((enemy)=>{
      const horizontal_vel = enemy_at_bounds ?  enemy.vel.negate() :  enemy.vel // If any enemy is at the bounds, reverse velocity of all enemies
      return {...enemy,
      // If cooldown has exceeded a specific number of ticks, we make the enemies move down for one tick, then on next tick we cancel out that velocity so they stop moving vertically 
      vel: enemy.cooldown === ENEMY_COOLDOWN_TICKS ? horizontal_vel.add(ENEMY_VERTICAL_VEL) : enemy.cooldown === -1 ? horizontal_vel.add(ENEMY_VERTICAL_VEL.negate()):horizontal_vel, 
      cooldown: enemy.cooldown === ENEMY_COOLDOWN_TICKS ? -1 : enemy.cooldown + 1 // Set cooldown to -1 when we've reached required ticks, so we can cancel out velocity next tick
    }})
}

  // Function to handle collisions between objects that should cause a change of state (not all collision do, eg: enemies and enemy bullets )
  // Derived from Asteroids example
  const handleCollisions = (s:State) => {
    const
      bodiesCollided = ([a,b]:[Body,Body]) => a.pos.sub(b.pos).len() < a.radius + b.radius, // Objects have collided if they are within each others damage radius
      shipCollided = s.bullets.filter((bullet)=>bullet.type==="enemy_bullet").filter(r=>bodiesCollided([s.ship,r])).length > 0, // Only count collision between bullet and ship if it's an enemy bullet
      allBulletsAndEnemies = flatMap(s.bullets.filter((bullet)=>bullet.type!=="enemy_bullet"), b=> s.enemies.map<[Body,Body]>(e=>([b,e]))), // Only count collision between bullet and enemy if it's a player bullet
      collidedBulletsAndEnemies = allBulletsAndEnemies.filter(bodiesCollided),
      collidedEnemies = collidedBulletsAndEnemies.map(([_,enemy])=>enemy),
      // If all enemies are killed, start new level by reinitialising enemies and shields
      newEnemies:ReadonlyArray<Body> = s.enemies.length!==0? []:initial_enemies.map((enemy)=>{return{...enemy,vel:enemy.vel.add(ENEMY_VEL.scale(0.5*s.level))}}) ,
      newShields:ReadonlyArray<Body> = s.enemies.length!==0? []:initial_shields,
      allBulletsAndShields = flatMap(s.bullets, b=> s.shields.map<[Body,Body]>(sh=>([b,sh]))), // Both enemy and player bullets cause damage to shields
      collidedBulletsAndShields = allBulletsAndShields.filter(bodiesCollided),
      collidedShields = collidedBulletsAndShields.map(([_,shield])=>shield),
      collidedBullets = collidedBulletsAndEnemies.map(([bullet,_])=>bullet).concat(collidedBulletsAndShields.map(([bullet,_])=>bullet))
    const cut = except((a:Body)=>(b:Body)=>a.id === b.id) // Funtion to remove objects due to collisions. 
    return <State>{
      ...s,
      bullets: !s.gameOver ? cut(s.bullets)(collidedBullets):[],
      enemies: !s.gameOver ? cut(s.enemies)(collidedEnemies).concat(newEnemies):[],
      exit: !s.gameOver ? s.exit.concat(collidedBullets,collidedEnemies,collidedShields):s.exit.concat(s.bullets,s.enemies,s.ship),
      gameOver: s.gameOver ? s.gameOver : shipCollided, // If enemy bullet collided with player, the game is over. Once game is over, lock into that state until player restarts
      score: s.score + collidedEnemies.length,
      highScore: shipCollided && (s.score+collidedEnemies.length)>s.highScore ? s.score+collidedEnemies.length: s.highScore,
      shields:cut(s.shields)(collidedShields).concat(newShields),
      level:s.enemies.length===0 ? s.level+1:s.level
    }
  }

  // Function to update state of objects on every tick 
  const tick = (s:State) => {
    // Remove any bullets that go outside the canvas to avoid wasted memory
    const out_of_bounds = (b:Body) => (b.pos.y<0 || b.pos.y>580),
      not = <T>(f:(x:T) => boolean) => (x:T)=>!f(x),
      expiredBullets:Body[] = s.bullets.filter(out_of_bounds),
      activeBullets:Body[] = s.bullets.filter(not(out_of_bounds))

      return handleCollisions({...s,
        ship:moveObj(s.ship),
        bullets:activeBullets.map(moveObj),
        enemies: moveEnemies(s.enemies).map((moveObj)) ,
        exit:expiredBullets
      })

  }

  // Function to change the state of the game depending on user input streams and enemy fire stream
  // Derived from Asteroids example
  const reduceState = (s:State,event:Move|Tick|Shoot|Restart|EnemyShoot)=>
    event instanceof Move ? {...s,
      ship: {...s.ship, vel: event.direction < 0 ? SHIP_VEL.negate() : event.direction ? SHIP_VEL : SHIP_VEL.zero()}, // If direction is negative we're going left, so negate velocity. If direction is zero we're stopping, so velocity is zero
    } :

    event instanceof Shoot ? {...s,
      bullets:s.bullets.concat([createBullet(s,s.ship,FRIENDLY_BULLET_VEL)]), // Add a friendly bullet when the user presses space
      objCount: s.objCount + 1,
    } :

    event instanceof EnemyShoot ? {...s,
      bullets:s.bullets.concat(s.enemies.length>0 ? enemyFire(s,event.enemy_index): []),
      objCount: s.objCount + 1,
    }
    :

    event instanceof Restart ? {...initialState, // When user restarts, go back to initial state, but keep high score
    highScore:s.highScore,
    exit:s.exit.concat(s.enemies,s.bullets,s.shields)
    }
    :
    tick(s);
    
  // Function that is used to update the html so that the user can see changes to the state of the game  
  // Derived from Asteroids example
  function updateView(s:State): void {
    const ship = document.getElementById("ship")!,
      score = document.getElementById("score")!,
      svg = document.getElementById("canvas")!,
      highScore = document.getElementById("high_score")!,
      level = document.getElementById("level")!;

      // Move the ship to the it's currrent position in the game
    if (ship) ship.setAttribute('transform',
      `translate(${s.ship.pos.x},${s.ship.pos.y})`)

    // Display the score for the game, which is the number of enemies hit by the player (resets when game is restarted)
    score.innerHTML = `Score: ${s.score}`
    highScore.innerHTML = ` High Score: ${s.highScore}`
    level.innerHTML = `Level: ${s.level}`

    s.bullets.forEach(b=>{
      const createBulletView = () => {
        const v= document.createElementNS(svg.namespaceURI, "ellipse")!;
        v.setAttribute("id",b.id);
        v.setAttribute("rx",BULLET_RAD.toString());
        v.setAttribute("ry",BULLET_RAD.toString());
        v.classList.add("bullet")
        svg.append(v)
        return v;
      }
      // Check if bullet element is already in html, if not create one. Then set it's position depending on the state of the game.
      const v = document.getElementById(b.id) || createBulletView();
      v.setAttribute("cx",String(b.pos.x))
      v.setAttribute("cy",String(b.pos.y))
    })

    // Removed ny objects that have either left the canvas or got destroyed through collision
    s.exit.forEach(b=>{
      const v = document.getElementById(b.id)
      if (v) svg.removeChild(v)
    })

    s.enemies.forEach(e=>{
      const createEnemyView = () => {
        const v= document.createElementNS(svg.namespaceURI, "polygon")!;
        v.setAttribute("id",e.id);
        v.setAttribute("points", "-15,20 15,20 0,-20");
        v.classList.add("enemy")
        svg.append(v)
        return v;
      }
      // Check if enemy element is already in html, if not create one. Then set it's position depending on the state of the game.
      const v = document.getElementById(e.id) || createEnemyView();
      v.setAttribute('transform',`translate(${e.pos.x},${e.pos.y})`)
    })

    s.shields.forEach(sh=>{
      const createShieldView = () => {
        const v= document.createElementNS(svg.namespaceURI, "rect")!;
        v.setAttribute("id",sh.id);
        v.setAttribute("x", `${sh.pos.x}`);
        v.setAttribute("y", `${sh.pos.y}`);
        v.setAttribute("height",SHIELD_BLOCK_SIZE.toString())
        v.setAttribute("width",SHIELD_BLOCK_SIZE.toString())
        v.setAttribute("fill", "#1dff00");
        v.classList.add("enemy")
        svg.append(v)
        return v;
      }
      const v = document.getElementById(sh.id) || createShieldView();
    })

    // If game has been restarted after ending, then remove game over text and add the ship back
    if (!s.gameOver && document.getElementById("gameover")){
      svg.removeChild(document.getElementById("gameover"))
      const v= document.createElementNS(svg.namespaceURI, "polygon")!;
      v.setAttribute("id","ship");
      v.setAttribute("points", "-15,20 15,20 0,-20");
      v.setAttribute('transform',"translate(0,0)")
      v.setAttribute("style","fill:lightblue")
      v.classList.add("ship")
      svg.append(v)
    }

    // If game ended then add text to indicate that it's over and show instructions on how to restart. Also remove ship from view
    if(s.gameOver && !document.getElementById("gameover")) {
      const v = document.createElementNS(svg.namespaceURI, "text")!;
      attr(v,{
        x: CANVAS_SIZE/6,
        y: CANVAS_SIZE/2,
        class: "gameover",
        id:"gameover"
      });
      v.textContent = "Game Over: Press R to Restart";
      svg.appendChild(v);
      // if (ship) svg.removeChild(ship)
    }


  }

    // Create random stream of enemy fire
    const randomEnemyFire= interval(1000).pipe(scan((r,_)=>r.next(),new RNG(20)),map((r)=>new EnemyShoot(r.nextFloat())))


    // Main game observable stream
    const stream = interval(10)
      .pipe(map(elapsed=>new Tick(elapsed)), merge(startMoveLeft,startMoveRight,stopMoveLeft,stopMoveRight,shoot,restart,randomEnemyFire),scan(reduceState,initialState))

    const subscription = stream.subscribe(updateView)

}
  
  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      spaceinvaders();
    }

// Miscellaneous functions taken from Asteroids example
const
  attr = (e:Element, o:Object) =>
    { for(const k in o) e.setAttribute(k,String(o[k]))}


       /**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T,U>(
  a:ReadonlyArray<T>,
  f:(a:T)=>ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

 
/**
 * Composable not: invert boolean result of given function
 * @param f a function returning boolean
 * @param x the value that will be tested with f
 */
 const not = <T>(f:(x:T)=>boolean)=> (x:T)=> !f(x)


 /**
 * is e an element of a using the eq function to test equality?
 * @param eq equality test function for two Ts
 * @param a an array that will be searched
 * @param e an element to search a for
 */
  const elem = 
    <T>(eq: (_:T)=>(_:T)=>boolean)=> 
      (a:ReadonlyArray<T>)=> 
        (e:T)=> a.findIndex(eq(e)) >= 0

/**
 * array a except anything in b
 * @param eq equality test function for two Ts
 * @param a array to be filtered
 * @param b array of elements to be filtered out of a
 */ 
 const except = 
 <T>(eq: (_:T)=>(_:T)=>boolean)=>
   (a:ReadonlyArray<T>)=> 
     (b:ReadonlyArray<T>)=> a.filter(not(elem(eq)(b)))

  
  

