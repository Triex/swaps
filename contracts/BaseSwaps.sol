pragma solidity ^0.5.6;

import "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

// todo: checkable
contract BaseSwaps is Ownable, ReentrancyGuard {
    using SafeMath for uint;

    bool public isSwapped;
    bool public isCancelled;

    address public baseAddress;
    address public quoteAddress;

    uint public expirationTimestamp;

    mapping(address => uint) private limits;
    mapping(address => uint) private raised;
    mapping(address => address[]) private investors;
    mapping(address => mapping(address => uint)) private investments;

    event Cancel();
    event Deposit(address indexed token, address indexed user, uint amount, uint balance);
    event Refund(address indexed token, address indexed user, uint amount);
    event Swap(address indexed byUser);

    constructor(
        address _owner,
        address _baseAddress,
        address _quoteAddress,
        uint _baseLimit,
        uint _quoteLimit,
        uint _expirationTimestamp
    ) public {
        require(_baseAddress != _quoteAddress, "Exchanged tokens must be different");
        require(_baseLimit > 0, "Base limit must be positive");
        require(_quoteLimit > 0, "Quote limit must be positive");
        require(_expirationTimestamp > now, "Expiration time must be in future");

        baseAddress = _baseAddress;
        quoteAddress = _quoteAddress;
        limits[baseAddress] = _baseLimit;
        limits[quoteAddress] = _quoteLimit;
        expirationTimestamp = _expirationTimestamp;

        _transferOwnership(_owner);
    }

    modifier onlyInvestor() {
        require(_isInvestor(msg.sender), "Allowed only for investors");
        _;
    }

    function()
        external
        payable
        nonReentrant
    {
        _deposit(address(0), msg.sender, msg.value);
    }

    function deposit()
        external
        payable
        nonReentrant
    {
        _deposit(address(0), msg.sender, msg.value);
    }

    function depositTokens(address _token) external nonReentrant {
        address from = msg.sender;
        uint allowance = IERC20(_token).allowance(from, address(this));
        IERC20(_token).transferFrom(from, address(this), allowance);
        _deposit(_token, from, allowance);
    }

    function swap() external nonReentrant {
        _swap();
    }

    function cancel()
        external
        nonReentrant
    {
        require(!isCancelled, "Already cancelled");
        require(!isSwapped, "Already swapped");
        require(msg.sender == owner() || expirationTimestamp > now, "Only by owner or after time expiration");

        address[2] memory tokens = [baseAddress, quoteAddress];
        for (uint t = 0; t < tokens.length; t++) {
            address token = tokens[t];
            for (uint u = 0; u < investors[token].length; u++) {
                address user = investors[token][u];
                uint userInvestment = investments[token][user];
                _sendTokens(token, user, userInvestment);
            }
        }

        isCancelled = true;
        emit Cancel();
    }

    function refund()
        external
        onlyInvestor
        nonReentrant
    {
        address[2] memory tokens = [baseAddress, quoteAddress];
        for (uint t = 0; t < tokens.length; t++) {
            address token = tokens[t];
            uint investment = _removeInvestment(investments[token], msg.sender);
            _removeInvestor(investors[token], msg.sender);

            if (investment > 0) {
                raised[token] = raised[token].sub(investment);
                _sendTokens(token, msg.sender, investment);
            }

            emit Refund(token, msg.sender, investment);
        }
    }

    function tokenFallback(address, uint, bytes memory) public pure {
        revert("Use approve instead");
    }

    function _swap() internal {
        require(!isSwapped, "Already swapped");
        require(!isCancelled, "Already cancelled");
        require(raised[baseAddress] == limits[baseAddress], "Base tokens not filled");
        require(raised[quoteAddress] == limits[quoteAddress], "Quote tokens not filled");
        require(now <= expirationTimestamp, "Contract expired");

        _distribute(baseAddress, quoteAddress);
        _distribute(quoteAddress, baseAddress);

        isSwapped = true;
        emit Swap(msg.sender);
    }

    function _distribute(address _aSide, address _bSide) internal {
        for (uint i = 0; i < investors[_aSide].length; i++) {
            address user = investors[_aSide][i];
            uint aSideRaised = raised[_aSide];
            uint userInvestment = investments[_aSide][user];
            uint bSideRaised = raised[_bSide];
            uint toPay = userInvestment.mul(bSideRaised).div(aSideRaised);

            _sendTokens(_bSide, user, toPay);
        }
    }

    function _sendTokens(address _token, address _to, uint _amount) internal {
        if (_token == address(0)) {
            address(uint160(_to)).transfer(_amount);
        } else {
            IERC20(_token).transfer(_to, _amount);
        }
    }

    function _removeInvestment(
        mapping(address => uint) storage _investments,
        address _investor
    )
        internal
        returns (uint _investment)
    {
        _investment = _investments[_investor];
        if (_investment > 0) {
            delete _investments[_investor];
        }
    }

    function _removeInvestor(address[] storage _array, address _investor) internal {
        uint idx = _array.length - 1;
        for (uint i = 0; i < _array.length - 1; i++) {
            if (_array[i] == _investor) {
                idx = i;
                break;
            }
        }

        _array[idx] = _array[_array.length - 1];
        delete _array[_array.length - 1];
        _array.length--;
    }

    function _deposit(
        address _token,
        address _from,
        uint _amount
    ) internal {
        uint amount = _amount;
        require(baseAddress == _token || quoteAddress == _token, "You can deposit only base or quote currency");
        require(amount > 0, "Currency amount must be positive");
        require(raised[_token] < limits[_token], "Limit already reached");

        if (!_isInvestor(_from)) {
            investors[_token].push(_from);
        }

        uint raisedWithOverflow = raised[_token].add(amount);
        if (raisedWithOverflow > limits[_token]) {
            uint overflow = raisedWithOverflow.sub(limits[_token]);
            _sendTokens(_token, _from, overflow);
            amount = raisedWithOverflow.sub(overflow);
        }

        investments[_token][_from] = investments[_token][_from].add(amount);

        raised[_token] = raised[_token].add(amount);
        emit Deposit(
            _token,
            _from,
            amount,
            investments[_token][_from]
        );

        if ((raised[baseAddress] == limits[baseAddress]) && (raised[quoteAddress] == limits[quoteAddress])) {
            _swap();
        }
    }

    function _isInvestor(address _who) internal view returns (bool) {
        if (investments[baseAddress][_who] > 0) {
            return true;
        }

        if (investments[quoteAddress][_who] > 0) {
            return true;
        }

        return false;
    }
}
